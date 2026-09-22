import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { PassThrough, Readable } from 'node:stream';
import {
  FLUSH_PACKET,
  toGitBinary,
  type GitServiceName,
} from '../../../git/git.constants.js';

@Injectable()
export class RefAdvertisementService {
  private readonly logger = new Logger(RefAdvertisementService.name);

  /** pkt-line: 4 hex bytes of total length, then the payload. */
  convertToPacketLine(str: string) {
    const len = (Buffer.byteLength(str) + 4).toString(16).padStart(4, '0');
    return len + str;
  }

  /** The `GET /info/refs` body: the service header, a flush packet, then the advertisement. SSH sends the advertisement alone - the header exists so an HTTP client can tell which service answered. */
  advertise({
    repoDirectory,
    service,
  }: {
    repoDirectory: string;
    service: GitServiceName;
  }): Readable {
    const output = new PassThrough();

    output.write(this.convertToPacketLine(`# service=${service}\n`));
    output.write(FLUSH_PACKET);
    this.advertiseRefs({ repoDirectory, service }).pipe(output);

    return output;
  }

  /** Exactly what `--advertise-refs` prints: the refs, their capabilities, and a flush packet. */
  advertiseRefs({
    repoDirectory,
    service,
  }: {
    repoDirectory: string;
    service: GitServiceName;
  }): Readable {
    const binary = toGitBinary(service);
    const output = new PassThrough();

    const child = spawn('git', [
      binary,
      '--stateless-rpc',
      '--advertise-refs',
      repoDirectory,
    ]);
    child.stdout.pipe(output);
    child.stderr.on('data', (chunk: Buffer) =>
      this.logger.warn(`${binary} stderr: ${chunk.toString()}`),
    );
    child.on('error', (error) => output.destroy(error));

    return output;
  }
}
