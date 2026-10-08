import { Injectable, Logger } from '@nestjs/common';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { Readable, type Writable } from 'node:stream';
import {
  protocolEnv,
  toGitBinary,
  type GitServiceName,
} from '../../../lib/git/protocol/git-service.js';
import { spawnPack } from '../../../lib/git/protocol/spawn-pack.js';

interface StreamOptions {
  repoDirectory: string;
  /** The client's request body: `want`/`have` lines or a packfile. */
  input: Readable;
  /** What the client asked for in `Git-Protocol` or `GIT_PROTOCOL`. */
  protocol?: string;
}

/** Runs `git upload-pack` / `git receive-pack` in `--stateless-rpc` mode over Readables, knowing nothing of HTTP so a test can drive it with `Readable.from(buffer)`. */
@Injectable()
export class PackProcessService {
  private readonly logger = new Logger(PackProcessService.name);

  streamUploadPack(options: StreamOptions): Readable {
    return this.spawnBinary({ ...options, service: 'git-upload-pack' });
  }

  streamReceivePack(options: StreamOptions): Readable {
    return this.spawnBinary({ ...options, service: 'git-receive-pack' });
  }

  /** The SSH form: one process per session, speaking the full protocol in both directions. `--stateless-rpc` answers a single HTTP request and then stops listening, which is the wrong shape for a channel that stays open. */
  spawnInteractive({
    repoDirectory,
    service,
    protocol,
  }: {
    repoDirectory: string;
    service: GitServiceName;
    protocol?: string;
  }): ChildProcessByStdio<Writable, Readable, Readable> {
    return spawn('git', [toGitBinary(service), repoDirectory], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...protocolEnv(protocol) },
    });
  }

  private spawnBinary({
    service,
    ...options
  }: StreamOptions & { service: GitServiceName }): Readable {
    return spawnPack({
      ...options,
      service,
      warn: (message) => this.logger.warn(message),
    });
  }
}
