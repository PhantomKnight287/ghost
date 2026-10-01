import { type Database, schema } from '@ghost/db';
import type { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq } from 'drizzle-orm';

import type { Auth } from '../auth.js';

/** The `account` row a user linked GitHub with, which Better Auth reads the token from. */
export async function githubAccountIdOf(
  db: Pick<Database, 'select'>,
  userId: string,
) {
  const [account] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, 'github'),
      ),
    );
  return account?.id ?? null;
}

/** The user's GitHub token, refreshed by Better Auth when it can be; null when GitHub is not linked. */
export async function githubAccessToken(
  db: Pick<Database, 'select'>,
  auth: AuthService<Auth>,
  userId: string,
) {
  const accountId = await githubAccountIdOf(db, userId);
  if (!accountId) return null;
  const { accessToken } = await auth.api.getAccessToken({
    body: { accountId, userId },
  });
  return accessToken || null;
}
