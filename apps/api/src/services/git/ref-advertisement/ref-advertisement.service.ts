import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { PassThrough, Readable } from 'node:stream';
import {
  FLUSH_PACKET,
  protocolEnv,
  toGitBinary,
  type GitServiceName,
} from '../../../git/git.constants.js';
import { pktLine } from '../../../lib/git/protocol/pkt-line.js';

@Injectable()
export class RefAdvertisementService {
  private readonly logger = new Logger(RefAdvertisementService.name);

  /** The `GET /info/refs` body: the service header, a flush packet, then the advertisement. SSH sends the advertisement alone - the header exists so an HTTP client can tell which service answered. */
  advertise({
    repoDirectory,
    service,
    protocol,
  }: {
    repoDirectory: string;
    service: GitServiceName;
    protocol?: string;
  }): Readable {
    const output = new PassThrough();

    output.write(pktLine(`# service=${service}\n`));
    output.write(FLUSH_PACKET);
    this.advertiseRefs({ repoDirectory, service, protocol }).pipe(output);

    return output;
  }

  /** Exactly what `--advertise-refs` prints: the refs, their capabilities, and a flush packet. */
  advertiseRefs({
    repoDirectory,
    service,
    protocol,
  }: {
    repoDirectory: string;
    service: GitServiceName;
    protocol?: string;
  }): Readable {
    const binary = toGitBinary(service);
    const output = new PassThrough();

    const child = spawn(
      'git',
      [binary, '--stateless-rpc', '--advertise-refs', repoDirectory],
      { env: { ...process.env, ...protocolEnv(protocol) } },
    );
    child.stdout.pipe(output);
    child.stderr.on('data', (chunk: Buffer) =>
      this.logger.warn(`${binary} stderr: ${chunk.toString()}`),
    );
    child.on('error', (error) => output.destroy(error));

    return output;
  }
}
