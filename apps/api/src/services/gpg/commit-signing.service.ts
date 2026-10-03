import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CommitSigner } from '../../lib/git/commits/commit-signature.js';
import {
  readSigningKey,
  type SigningKey,
  signPayload,
} from '../../lib/gpg/openpgp.js';

/** Ghost's own signing key, from `COMMIT_SIGNING_KEY`: the base64 of an armored private key with no passphrase. Without one, commits Ghost writes go out unsigned. */
@Injectable()
export class CommitSigningService implements OnModuleInit {
  private key?: SigningKey;

  constructor(private readonly config: ConfigService) {}

  // Read at boot, so a malformed key stops the server instead of failing the first merge.
  async onModuleInit() {
    const encoded = this.config.get<string>('COMMIT_SIGNING_KEY');
    if (!encoded) return;
    this.key = await readSigningKey(
      Buffer.from(encoded, 'base64').toString('utf8'),
    ).catch((cause: unknown) => {
      throw new Error('COMMIT_SIGNING_KEY is not a usable private key', {
        cause,
      });
    });
  }

  get signer(): CommitSigner | undefined {
    const key = this.key;
    return (
      key && ((payload) => signPayload({ payload, privateKey: key.privateKey }))
    );
  }

  get publicKey(): string | undefined {
    return this.key?.publicKey;
  }
}
