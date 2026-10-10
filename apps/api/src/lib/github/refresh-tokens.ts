import { createHash, randomBytes } from 'node:crypto';

import { type Database, schema } from '@ghost/db';
import { and, eq } from 'drizzle-orm';

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
  db: Database,
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

/** Deletes the app's refresh token and returns what it granted, or null when it is unknown, another app's, or expired. Deleting in the same statement lets only one of two concurrent refreshes win. */
export async function spendRefreshToken(
  db: Database,
  clientId: string,
  token: string,
): Promise<RefreshGrant | null> {
  const table = schema.oauthAppRefreshToken;
  const [spent] = await db
    .delete(table)
    .where(
      and(
        eq(table.tokenHash, hashRefreshToken(token)),
        eq(table.clientId, clientId),
      ),
    )
    .returning({
      userId: table.userId,
      scopes: table.scopes,
      accessKeyId: table.accessKeyId,
      expiresAt: table.expiresAt,
    });
  if (!spent || spent.expiresAt <= new Date()) return null;
  return {
    userId: spent.userId,
    scopes: spent.scopes,
    accessKeyId: spent.accessKeyId,
  };
}
