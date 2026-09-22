import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { DATABASE } from '../../database/database.module.js';
import { keyTypeOf, readPublicKey } from '../../lib/git/ssh/public-key.js';
import { isoTimestamp } from '../../utils/index.js';
import type { ListSshKeysResponseDTO, SshKeyDTO } from './dto/ssh-key.dto.js';
import { MAX_TITLE_LENGTH } from './dto/ssh-key.dto.js';
import {
  InvalidSshKeyError,
  SshKeyAlreadyExistsError,
  SshKeyNotFoundError,
} from './ssh-keys.errors.js';

/** OpenSSH public keys an account uploads so it can push and fetch over SSH. Unlike a signing key, nothing here is checked against an address: the key proves who is connecting, not who wrote a commit. */
@Injectable()
export class SshKeysService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(userId: string): Promise<ListSshKeysResponseDTO> {
    const rows = await this.db
      .select({
        id: schema.userSshKey.id,
        title: schema.userSshKey.title,
        publicKey: schema.userSshKey.publicKey,
        fingerprint: schema.userSshKey.fingerprint,
        lastUsedAt: isoTimestamp(schema.userSshKey.lastUsedAt),
        createdAt: isoTimestamp(schema.userSshKey.createdAt),
      })
      .from(schema.userSshKey)
      .where(eq(schema.userSshKey.userId, userId))
      .orderBy(schema.userSshKey.createdAt);

    return {
      keys: rows.map(({ publicKey, ...key }) => ({
        ...key,
        type: keyTypeOf(publicKey),
      })),
    };
  }

  async add(userId: string, line: string, title?: string): Promise<SshKeyDTO> {
    const key = (() => {
      try {
        return readPublicKey(line);
      } catch (error) {
        throw new InvalidSshKeyError((error as Error).message);
      }
    })();

    const [row] = await this.db
      .insert(schema.userSshKey)
      .values({
        id: `ssh_${nanoid(16)}`,
        userId,
        title:
          (title ?? key.comment ?? '').trim().slice(0, MAX_TITLE_LENGTH) ||
          key.type,
        fingerprint: key.fingerprint,
        publicKey: key.blob,
      })
      .onConflictDoNothing()
      .returning({
        id: schema.userSshKey.id,
        title: schema.userSshKey.title,
        fingerprint: schema.userSshKey.fingerprint,
        lastUsedAt: isoTimestamp(schema.userSshKey.lastUsedAt),
        createdAt: isoTimestamp(schema.userSshKey.createdAt),
      });

    // A fingerprint belongs to one account, so a clash is someone else's key - or this account adding the same one twice.
    if (!row) throw new SshKeyAlreadyExistsError();

    return { ...row, type: key.type };
  }

  async remove(userId: string, id: string): Promise<void> {
    // Ownership is part of the match, so another account's key id deletes nothing rather than deleting theirs.
    const [row] = await this.db
      .delete(schema.userSshKey)
      .where(
        and(eq(schema.userSshKey.id, id), eq(schema.userSshKey.userId, userId)),
      )
      .returning({ id: schema.userSshKey.id });

    if (!row) throw new SshKeyNotFoundError();
  }

  /** The SSH server's whole identity lookup: one indexed read per authentication attempt. */
  async findByFingerprint(fingerprint: string) {
    const [row] = await this.db
      .select({
        id: schema.userSshKey.id,
        userId: schema.userSshKey.userId,
        username: schema.user.username,
        publicKey: schema.userSshKey.publicKey,
      })
      .from(schema.userSshKey)
      .innerJoin(schema.user, eq(schema.user.id, schema.userSshKey.userId))
      .where(eq(schema.userSshKey.fingerprint, fingerprint))
      .limit(1);

    return row ?? null;
  }

  async markUsed(id: string): Promise<void> {
    await this.db
      .update(schema.userSshKey)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.userSshKey.id, id));
  }
}
