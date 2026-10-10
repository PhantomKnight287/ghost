import { createHash, randomBytes } from 'node:crypto';

import { schema } from '@ghost/db';
import { and, eq, sql } from 'drizzle-orm';

import type { Executor } from '../db/executor.js';

/** GitHub's lifetimes for expiring user tokens, in seconds. */
export const ACCESS_TOKEN_EXPIRES_IN = 28800;
export const REFRESH_TOKEN_EXPIRES_IN = 15897600;

/** What a refresh token grants again: the user, the scopes they approved, and the key it was issued beside. */
export type RefreshGrant = {
  userId: string;
  scopes: string[];
  accessKeyId: string;
};

export const newRefreshToken = () =>
  `ghost_rt_${randomBytes(32).toString('base64url')}`;

export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Stores a refresh token for the grant and returns it; only its hash is kept. */
export async function issueRefreshToken(
  db: Executor,
  clientId: string,
  grant: RefreshGrant,
): Promise<string> {
  const token = newRefreshToken();
  await db.insert(schema.oauthAppRefreshToken).values({
    ...grant,
    clientId,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN * 1000),
  });
  return token;
}

/** Serializes a refresh and a revoke of one user's grant to an app, so a revoke never misses the pair a refresh is minting. Held until the transaction ends. */
export async function lockGrant(
  tx: Executor,
  clientId: string,
  userId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${clientId}), hashtext(${userId}))`,
  );
}

/** Deletes the app's refresh token under the grant's lock and returns what it granted, or null when it is unknown, another app's, or expired. Run inside a transaction: the lock lasts until the new pair is stored. */
export async function spendRefreshToken(
  tx: Executor,
  clientId: string,
  token: string,
): Promise<RefreshGrant | null> {
  const table = schema.oauthAppRefreshToken;
  const match = and(
    eq(table.tokenHash, hashRefreshToken(token)),
    eq(table.clientId, clientId),
  );
  const [owner] = await tx
    .select({ userId: table.userId })
    .from(table)
    .where(match);
  if (!owner) return null;
  await lockGrant(tx, clientId, owner.userId);
  // A concurrent refresh or revoke may have taken the row while this one waited for the lock.
  const [spent] = await tx.delete(table).where(match).returning({
    userId: table.userId,
    scopes: table.scopes,
    accessKeyId: table.accessKeyId,
    expiresAt: table.expiresAt,
  });
  if (!spent) return null;
  const { expiresAt, ...grant } = spent;
  return expiresAt <= new Date() ? null : grant;
}
