import { Injectable, Logger } from '@nestjs/common';
import { PassThrough, Readable } from 'node:stream';
import { FLUSH_PACKET } from '../../../lib/git/protocol/pkt-line.js';
import { type GitServiceName } from '../../../lib/git/protocol/git-service.js';
import { pktLine } from '../../../lib/git/protocol/pkt-line.js';
import { spawnPack } from '../../../lib/git/protocol/spawn-pack.js';

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
    return spawnPack({
      service,
      repoDirectory,
      protocol,
      flags: ['--advertise-refs'],
      warn: (message) => this.logger.warn(message),
    });
  }
}
