import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ssh2, {
  type Connection,
  type PublicKeyAuthContext,
  type ServerChannel,
  type Session,
} from 'ssh2';

// ssh2 is CommonJS: a named import type-checks and then fails to resolve at runtime under ESM.
const { Server } = ssh2;
type SshServer = InstanceType<typeof Server>;

import { DomainError } from '../../../domain/errors.js';
import {
  type GitServiceName,
  toGitBinary,
} from '../../../git/git.constants.js';
import { GitService } from '../../../git/git.service.js';
import { spoolToFile } from '../../../lib/git/protocol/spool.js';
import { greeting, replyTo } from '../../../lib/git/ssh/easter-eggs.js';
import { parseGitCommand } from '../../../lib/git/ssh/git-command.js';
import {
  fingerprintOf,
  parseStoredKey,
} from '../../../lib/git/ssh/public-key.js';
import { SshKeysService } from '../../../resources/ssh-keys/ssh-keys.service.js';
import { PackProcessService } from '../pack-process/pack-process.service.js';
import { RefAdvertisementService } from '../ref-advertisement/ref-advertisement.service.js';
import {
  type Actor,
  type Repository,
  RepositoryAccessService,
} from '../repository-access/repository-access.service.js';

/** 10-31. Railway already answers on 2222, and a ghost may as well keep Halloween. */
const DEFAULT_PORT = 1031;
const MAX_AUTH_ATTEMPTS = 6;
const GIT_FATAL_EXIT = 128;
/** A restart can race the previous process's socket release. */
const LISTEN_RETRIES = 10;
const LISTEN_RETRY_MS = 1_000;
/** A stuck peer must not hold the process after HTTP has already closed. */
const CLOSE_TIMEOUT_MS = 5_000;

interface SessionActor {
  actor: Actor;
  /** The account the key belongs to, not the login the client typed - every connection logs in as `git`. */
  username: string;
}

/**
 * The SSH transport. It authenticates the connection, then runs exactly one of two git binaries on it.
 *
 * Nothing here is a shell: a command is matched against a regex, the repository comes from the database, and git is spawned with an argv array. A session that asks for anything else gets text and a non-zero exit.
 */
@Injectable()
export class SshServerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SshServerService.name);
  private server?: SshServer;
  /** net.Server.close() leaves open connections alone, so shutdown ends them itself. */
  private readonly clients = new Set<Connection>();
  private retryTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly keys: SshKeysService,
    private readonly access: RepositoryAccessService,
    private readonly git: GitService,
    private readonly packProcess: PackProcessService,
    private readonly refAdvertisement: RefAdvertisementService,
  ) {}

  onModuleInit() {
    const hostKey = this.config.get<string>('GIT_SSH_HOST_KEY');
    if (!hostKey) {
      this.logger.log('SSH transport off: GIT_SSH_HOST_KEY is not set');
      return;
    }

    const port = Number(this.config.get('GIT_SSH_PORT', DEFAULT_PORT));
    this.server = new Server(
      {
        hostKeys: [readHostKey(hostKey)],
        ident: 'ghost',
        // A clone can idle while the server packs objects, so the liveness check has to be generous enough not to cut one off.
        keepaliveInterval: 15_000,
        keepaliveCountMax: 8,
      },
      (client) => this.handle(client),
    );

    this.server.on('listening', () =>
      this.logger.log(`SSH transport listening on ${port}`),
    );
    let retries = 0;
    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && retries++ < LISTEN_RETRIES) {
        this.logger.warn(
          `SSH port ${port} busy, retry ${retries}/${LISTEN_RETRIES}`,
        );
        this.retryTimer = setTimeout(
          () => this.server?.listen(port, '0.0.0.0'),
          LISTEN_RETRY_MS,
        );
        return;
      }
      this.logger.error(`SSH server error: ${error.message}`);
    });
    this.server.listen(port, '0.0.0.0');
  }

  async onApplicationShutdown() {
    clearTimeout(this.retryTimer);
    const server = this.server;
    this.server = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CLOSE_TIMEOUT_MS).unref();
      server.close(() => resolve());
      for (const client of this.clients) client.end();
    });
  }

  private handle(client: Connection) {
    this.clients.add(client);
    client.on('close', () => this.clients.delete(client));
    const state: SessionActor = { actor: null, username: '' };
    let attempts = 0;

    client.on('authentication', (ctx) => {
      if (ctx.method !== 'publickey') {
        // Password and keyboard-interactive are never offered: a key is the only identity this server understands.
        if (++attempts >= MAX_AUTH_ATTEMPTS) return client.end();
        return ctx.reject(['publickey']);
      }

      void this.authenticate(ctx, state).catch((error: Error) => {
        this.logger.warn(`SSH authentication failed: ${error.message}`);
        ctx.reject();
      });
    });

    client.on('session', (accept) => this.session(accept(), state, client));
    // No forwarding of any kind: this connection carries git, or it carries nothing.
    client.on('request', (_accept, reject) => reject?.());
    client.on('tcpip', (_accept, reject) => reject());
    client.on('openssh.streamlocal', (_accept, reject) => reject());
    client.on('error', (error) =>
      this.logger.debug(`SSH client error: ${error.message}`),
    );
  }

  private async authenticate(ctx: PublicKeyAuthContext, state: SessionActor) {
    const row = await this.keys.findByFingerprint(fingerprintOf(ctx.key.data));
    if (!row) return ctx.reject();

    // No signature means the client is only asking whether the key would be accepted; the signed round follows.
    if (!ctx.signature || !ctx.blob) return ctx.accept();

    if (
      !parseStoredKey(row.publicKey).verify(
        ctx.blob,
        ctx.signature,
        ctx.hashAlgo,
      )
    ) {
      return ctx.reject();
    }

    state.actor = { userId: row.userId };
    state.username = row.username ?? 'there';
    ctx.accept();
    this.keys
      .markUsed(row.id)
      .catch((error: unknown) =>
        this.logger.warn(`Could not stamp key use: ${error}`),
      );
  }

  private session(session: Session, state: SessionActor, client: Connection) {
    session.on('exec', (accept, _reject, info) => {
      const channel = accept();
      // The connection outlives the channel on purpose: ending it while megabytes are still queued behind the flow-control window truncates the fetch.
      channel.on('close', () => client.end());
      void this.exec(channel, info.command, state).catch((error: Error) =>
        this.logger.error(`SSH session failed: ${error.message}`),
      );
    });

    session.on('shell', (accept) => {
      const channel = accept();
      channel.on('close', () => client.end());
      channel.write(greeting(state.username));
      end(channel, 1);
    });

    // A pty is refused rather than answered: OpenSSH prints one line about it and carries on to the greeting.
    session.on('pty', (_accept, reject) => reject?.());
    session.on('sftp', (_accept, reject) => reject?.());
    session.on('subsystem', (_accept, reject) => reject?.());
    session.on('x11', (_accept, reject) => reject?.());
  }

  private async exec(
    channel: ServerChannel,
    command: string,
    { actor, username }: SessionActor,
  ) {
    this.logger.debug(`SSH exec ${command}`);
    const parsed = parseGitCommand(command);
    if (!parsed) {
      channel.stderr.write(`${replyTo(command, username)}\n`);
      return end(channel, 1);
    }

    try {
      const repository = await this.access.authorize({
        username: parsed.username,
        repo: parsed.repo,
        actor,
        operation: parsed.service === 'git-receive-pack' ? 'write' : 'read',
      });
      const repoDirectory = await this.git.openRepository(
        repository.id,
        repository.defaultBranch,
      );

      if (parsed.service === 'git-receive-pack') {
        await this.push(channel, repository, repoDirectory, actor);
        return;
      }
      await this.fetch(channel, repoDirectory, parsed.service);
    } catch (error) {
      // SSH has no status line to carry this, so the reason goes where git prints remote errors.
      const message =
        error instanceof DomainError
          ? error.message
          : 'the server could not complete that request';
      if (!(error instanceof DomainError)) {
        this.logger.error(`SSH ${command} failed: ${(error as Error).message}`);
      }
      channel.stderr.write(`ghost: ${message}\n`);
      end(channel, GIT_FATAL_EXIT);
    }
  }

  /** A fetch is a straight duplex: the client's wants go to git, git's packfile comes back, and nothing is buffered on the way. */
  private fetch(
    channel: ServerChannel,
    repoDirectory: string,
    service: GitServiceName,
  ) {
    const binary = toGitBinary(service);

    return new Promise<void>((resolve) => {
      const child = this.packProcess.spawnInteractive({
        repoDirectory,
        service,
      });
      let running = true;

      channel.pipe(child.stdin);
      // `end: false`: a pipe that closes the channel itself gets there before the exit status does, and a client that never reads one calls the whole fetch a transport error.
      child.stdout.pipe(channel, { end: false });
      // Teed rather than piped: git's diagnosis belongs on the client's terminal, and a server log holding nothing but `ECONNRESET` cannot answer why a clone failed.
      child.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString();
        // git names the directory it failed on, which is a local cache path the client has no business learning.
        channel.stderr.write(message.replaceAll(repoDirectory, '<repository>'));
        this.logger.warn(`${binary} stderr: ${message.trim()}`);
      });

      // A client that hangs up mid-clone must not leave upload-pack packing objects nobody will read.
      channel.on('close', () => {
        if (!running) return;
        this.logger.debug(`${binary} killed: the client closed the channel`);
        child.kill('SIGTERM');
      });

      child.on('error', (error) => {
        this.logger.error(`${binary} could not run: ${error.message}`);
        channel.stderr.write(`ghost: ${binary} could not run\n`);
      });

      child.on('close', (code) => {
        running = false;
        if (code) this.logger.warn(`${binary} exited ${code}`);
        end(channel, code ?? 0);
        resolve();
      });
    });
  }

  /**
   * A push is spooled, committed to the log, and only then replayed into git - the same order the HTTP transport uses, so both share one commit point.
   *
   * The spool starts before the advertisement is written: the client may answer the moment it reads the refs, and an unattended channel drops whatever arrives first.
   */
  private async push(
    channel: ServerChannel,
    repository: Pick<Repository, 'id' | 'visibility' | 'defaultBranch'>,
    repoDirectory: string,
    actor: Actor,
  ) {
    const spooling = spoolToFile(channel);
    this.refAdvertisement
      .advertiseRefs({ repoDirectory, service: 'git-receive-pack' })
      .pipe(channel, { end: false });

    const spooled = await spooling;
    try {
      const { body } = await this.git.receivePack({
        repositoryId: repository.id,
        defaultBranch: repository.defaultBranch,
        isPublic: repository.visibility === 'public',
        body: spooled.body,
        pushedBy: actor?.userId ?? null,
      });

      await new Promise<void>((resolve, reject) => {
        body.on('error', reject);
        body.on('end', resolve);
        body.pipe(channel, { end: false });
      });
      end(channel, 0);
    } finally {
      await spooled.discard().catch(() => {});
    }
  }
}

function end(channel: ServerChannel, code: number) {
  channel.exit(code);
  channel.end();
}

/** The host key is one value in the environment, either PEM or the same PEM base64-encoded so it survives a single-line config field. */
function readHostKey(value: string) {
  return value.includes('-----BEGIN')
    ? value.replace(/\\n/g, '\n')
    : Buffer.from(value, 'base64').toString('utf8');
}
