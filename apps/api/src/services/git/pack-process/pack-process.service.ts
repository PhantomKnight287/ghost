import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { PassThrough, Readable } from 'node:stream';
import { toGitBinary, type GitServiceName } from '../../../git/git.constants.js';

interface StreamOptions {
  repoDirectory: string;
  /** The client's request body: `want`/`have` lines or a packfile. */
  input: Readable;
}

/**
 * Runs `git upload-pack` / `git receive-pack` in `--stateless-rpc` mode.
 *
 * Deliberately knows nothing about HTTP: it consumes a Readable and returns a
 * Readable, so a test can drive it with `Readable.from(buffer)`.
 */
@Injectable()
export class PackProcessService {
  private readonly logger = new Logger(PackProcessService.name);

  streamUploadPack(options: StreamOptions): Readable {
    return this.spawnBinary({ ...options, service: 'git-upload-pack' });
  }

  streamReceivePack(options: StreamOptions): Readable {
    return this.spawnBinary({ ...options, service: 'git-receive-pack' });
  }

  private spawnBinary({
    repoDirectory,
    input,
    service,
  }: StreamOptions & { service: GitServiceName }): Readable {
    const binary = toGitBinary(service);
    const output = new PassThrough();
    const child = spawn('git', [binary, '--stateless-rpc', repoDirectory]);

    input.pipe(child.stdin);
    child.stdout.pipe(output);
    child.stderr.on('data', (chunk: Buffer) =>
      this.logger.warn(`${binary} stderr: ${chunk.toString()}`),
    );
    child.on('error', (error) => output.destroy(error));

    return output;
  }
}
