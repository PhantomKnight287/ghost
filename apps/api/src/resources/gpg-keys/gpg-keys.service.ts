import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { DATABASE } from '../../database/database.module.js';
import { isoTimestamp } from '../../utils/index.js';
import { readPublicKey } from '../../lib/gpg/openpgp.js';
import { UsersService } from '../../services/users/users.service.js';
import type { GpgKeyDTO, ListGpgKeysResponseDTO } from './dto/gpg-key.dto.js';
import {
  GpgKeyAlreadyExistsError,
  GpgKeyEmailNotVerifiedError,
  GpgKeyNotFoundError,
  InvalidGpgKeyError,
} from './gpg-keys.errors.js';

/**
 * OpenPGP public keys an account uploads so its signed commits read as verified.
 *
 * A key is only accepted once one of its user ids is an address the account has already verified: the badge claims the commit's author signed it, and without that check anyone could upload a key naming someone else's address.
 */
const keyColumns = {
  id: schema.userGpgKey.id,
  keyId: schema.userGpgKey.keyId,
  fingerprint: schema.userGpgKey.fingerprint,
  publicKey: schema.userGpgKey.publicKey,
  createdAt: isoTimestamp(schema.userGpgKey.createdAt),
};

@Injectable()
export class GpgKeysService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
  ) {}

  async list(userId: string): Promise<ListGpgKeysResponseDTO> {
    const rows = await this.db
      .select(keyColumns)
      .from(schema.userGpgKey)
      .where(eq(schema.userGpgKey.userId, userId))
      .orderBy(schema.userGpgKey.createdAt);

    return {
      keys: await Promise.all(
        rows.map(async ({ publicKey, ...key }) => ({
          ...key,
          emails: await addressesOn(publicKey),
        })),
      ),
    };
  }

  async add(userId: string, armoredKey: string): Promise<GpgKeyDTO> {
    const key = await readPublicKey(armoredKey.trim()).catch((error: Error) => {
      throw new InvalidGpgKeyError(error.message);
    });

    if (key.revoked) throw new InvalidGpgKeyError('the key is revoked');
    if (key.expired) throw new InvalidGpgKeyError('the key has expired');

    const user = await this.users.getUserById(userId);
    const owned = await this.users.listVerifiedEmails(user);
    if (!key.emails.some((email) => owned.includes(email))) {
      throw new GpgKeyEmailNotVerifiedError(key.emails);
    }

    const [row] = await this.db
      .insert(schema.userGpgKey)
      .values({
        id: `gpg_${nanoid(16)}`,
        userId,
        keyId: key.keyId,
        fingerprint: key.fingerprint,
        publicKey: armoredKey.trim(),
      })
      .onConflictDoNothing()
      .returning({
        id: schema.userGpgKey.id,
        keyId: schema.userGpgKey.keyId,
        fingerprint: schema.userGpgKey.fingerprint,
        createdAt: isoTimestamp(schema.userGpgKey.createdAt),
      });

    // A key id belongs to one account, so a clash is someone else's key - or this account adding the same one twice.
    if (!row) throw new GpgKeyAlreadyExistsError();

    return { ...row, emails: key.emails };
  }

  async remove(userId: string, id: string): Promise<void> {
    // Ownership is part of the match, so another account's key id deletes nothing rather than deleting theirs.
    const [row] = await this.db
      .delete(schema.userGpgKey)
      .where(
        and(eq(schema.userGpgKey.id, id), eq(schema.userGpgKey.userId, userId)),
      )
      .returning({ id: schema.userGpgKey.id });

    if (!row) throw new GpgKeyNotFoundError();
  }
}

// Read back from the armor rather than stored twice: a key's user ids are only ever as current as the armor that was uploaded.
async function addressesOn(armoredKey: string): Promise<string[]> {
  return readPublicKey(armoredKey)
    .then((key) => key.emails)
    .catch(() => []);
}
