import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, type SQL } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { DATABASE } from '../../database/database.module.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import { keyTypeOf, readPublicKey } from '../../lib/git/ssh/public-key.js';
import {
  InvalidSshKeyError,
  SshKeyAlreadyExistsError,
  SshKeyNotFoundError,
} from '../../lib/ssh-keys/ssh-keys.errors.js';
import { MAX_TITLE_LENGTH } from '../ssh-keys/dto/ssh-key.dto.js';

const columns = {
  id: schema.userSshSigningKey.id,
  numericId: schema.userSshSigningKey.numericId,
  title: schema.userSshSigningKey.title,
  publicKey: schema.userSshSigningKey.publicKey,
  fingerprint: schema.userSshSigningKey.fingerprint,
  createdAt: isoTimestamp(schema.userSshSigningKey.createdAt),
};

/** OpenSSH public keys an account signs commits with (`gpg.format=ssh`). Kept apart from authentication keys, as on GitHub: a signing key never opens a git session. */
@Injectable()
export class SshSigningKeysService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(userId: string) {
    return {
      keys: await this.select(eq(schema.userSshSigningKey.userId, userId)),
    };
  }

  /** One of `userId`'s keys by its GitHub integer id; another account's id is not found. */
  async findByNumericId(userId: string, numericId: number) {
    const [key] = await this.select(
      and(
        eq(schema.userSshSigningKey.userId, userId),
        eq(schema.userSshSigningKey.numericId, numericId),
      ),
    );
    if (!key) throw new SshKeyNotFoundError();
    return key;
  }

  async add(userId: string, line: string, title?: string) {
    const key = (() => {
      try {
        return readPublicKey(line);
      } catch (error) {
        throw new InvalidSshKeyError((error as Error).message);
      }
    })();

    const [row] = await this.db
      .insert(schema.userSshSigningKey)
      .values({
        id: `sshsig_${nanoid(16)}`,
        userId,
        title:
          (title ?? key.comment ?? '').trim().slice(0, MAX_TITLE_LENGTH) ||
          key.type,
        fingerprint: key.fingerprint,
        publicKey: key.blob,
      })
      .onConflictDoNothing()
      .returning(columns);

    if (!row) throw new SshKeyAlreadyExistsError();
    return { ...row, type: key.type, publicKey: `${key.type} ${key.blob}` };
  }

  /** Ownership is part of the match, so another account's key id deletes nothing. */
  async remove(userId: string, where: { id: string } | { numericId: number }) {
    const [row] = await this.db
      .delete(schema.userSshSigningKey)
      .where(
        and(
          eq(schema.userSshSigningKey.userId, userId),
          'id' in where
            ? eq(schema.userSshSigningKey.id, where.id)
            : eq(schema.userSshSigningKey.numericId, where.numericId),
        ),
      )
      .returning({ id: schema.userSshSigningKey.id });

    if (!row) throw new SshKeyNotFoundError();
  }

  private async select(where: SQL | undefined) {
    const rows = await this.db
      .select(columns)
      .from(schema.userSshSigningKey)
      .where(where)
      .orderBy(schema.userSshSigningKey.createdAt);
    return rows.map((key) => {
      const type = keyTypeOf(key.publicKey);
      return { ...key, type, publicKey: `${type} ${key.publicKey}` };
    });
  }
}
