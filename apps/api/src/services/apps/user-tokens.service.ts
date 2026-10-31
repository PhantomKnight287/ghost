import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { generateUserToken, hashUserToken } from '../../lib/apps/user-token.js';
import type {
  TokenScope,
  UserToServerCaller,
} from '../../lib/apps/user-token-context.js';
import type { Executor } from '../../lib/db/executor.js';
import {
  ACCESS_TOKEN_EXPIRES_IN,
  lockGrant,
} from '../../lib/github/refresh-tokens.js';

/** `ghu_` tokens: a user signed in to a Ghost App, which then acts as them. Only the sha256 is kept. */
@Injectable()
export class UserTokensService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The token leaves in this response and nowhere else. `expires` follows the app's "Expire user authorization tokens". */
  async mint(
    executor: Executor,
    grant: {
      appId: string;
      userId: string;
      expires: boolean;
      scope?: TokenScope;
    },
  ) {
    const token = generateUserToken();
    const expiresAt = grant.expires
      ? new Date(Date.now() + ACCESS_TOKEN_EXPIRES_IN * 1000)
      : null;
    const [row] = await executor
      .insert(schema.appUserToken)
      .values({
        appId: grant.appId,
        userId: grant.userId,
        tokenHash: hashUserToken(token),
        expiresAt,
        ...grant.scope,
      })
      .returning({ id: schema.appUserToken.id });
    return { id: row!.id, token, expiresAt };
  }

  /** Null for a token that is unknown, expired, or of a deleted app. */
  async verify(token: string): Promise<UserToServerCaller | null> {
    const [caller] = await this.db
      .select({
        tokenId: schema.appUserToken.id,
        appId: schema.appUserToken.appId,
        userId: schema.appUserToken.userId,
        installationId: schema.appUserToken.installationId,
        permissions: schema.appUserToken.permissions,
        repositoryIds: schema.appUserToken.repositoryIds,
      })
      .from(schema.appUserToken)
      .innerJoin(schema.app, eq(schema.app.id, schema.appUserToken.appId))
      .where(
        and(
          eq(schema.appUserToken.tokenHash, hashUserToken(token)),
          isNull(schema.app.deletedAt),
          or(
            isNull(schema.appUserToken.expiresAt),
            gt(schema.appUserToken.expiresAt, new Date()),
          ),
        ),
      );
    return caller ?? null;
  }

  /** A live token of the app, for `POST /applications/{client_id}/token`; null when it is another app's, expired or unknown. */
  async lookup(appId: string, token: string) {
    const [row] = await this.db
      .select({
        id: schema.appUserToken.id,
        userId: schema.appUserToken.userId,
        createdAt: schema.appUserToken.createdAt,
        expiresAt: schema.appUserToken.expiresAt,
        installationId: schema.appUserToken.installationId,
        permissions: schema.appUserToken.permissions,
        repositoryIds: schema.appUserToken.repositoryIds,
      })
      .from(schema.appUserToken)
      .where(
        and(
          eq(schema.appUserToken.appId, appId),
          eq(schema.appUserToken.tokenHash, hashUserToken(token)),
          or(
            isNull(schema.appUserToken.expiresAt),
            gt(schema.appUserToken.expiresAt, new Date()),
          ),
        ),
      );
    return row ?? null;
  }

  /** Swaps a live token of the app for a new one with the same scope and expiry setting; the old one stops working. Null when the app has no such token. */
  async reset(appId: string, token: string) {
    return this.db.transaction(async (tx) => {
      const [old] = await tx
        .delete(schema.appUserToken)
        .where(
          and(
            eq(schema.appUserToken.appId, appId),
            eq(schema.appUserToken.tokenHash, hashUserToken(token)),
            or(
              isNull(schema.appUserToken.expiresAt),
              gt(schema.appUserToken.expiresAt, new Date()),
            ),
          ),
        )
        .returning({
          userId: schema.appUserToken.userId,
          expiresAt: schema.appUserToken.expiresAt,
          installationId: schema.appUserToken.installationId,
          permissions: schema.appUserToken.permissions,
          repositoryIds: schema.appUserToken.repositoryIds,
        });
      if (!old) return null;
      const { userId, expiresAt, ...scope } = old;
      return this.mint(tx, {
        appId,
        userId,
        expires: expiresAt !== null,
        scope,
      });
    });
  }

  /** Whether the app had the token; its refresh token stays, as on GitHub. */
  async revokeToken(appId: string, token: string) {
    const removed = await this.db
      .delete(schema.appUserToken)
      .where(
        and(
          eq(schema.appUserToken.appId, appId),
          eq(schema.appUserToken.tokenHash, hashUserToken(token)),
        ),
      )
      .returning({ id: schema.appUserToken.id });
    return removed.length > 0;
  }

  /** Ends the user's authorization of the app: every `ghu_` and `ghr_` token and the consent, so the app asks again. Under the grant's lock, so a refresh in flight cannot mint a pair that survives it. Whether there was anything to revoke. */
  async revokeUser(
    tx: Executor,
    grant: { appId: string; clientId: string; userId: string },
  ) {
    await lockGrant(tx, grant.clientId, grant.userId);
    const tokens = await tx
      .delete(schema.appUserToken)
      .where(
        and(
          eq(schema.appUserToken.appId, grant.appId),
          eq(schema.appUserToken.userId, grant.userId),
        ),
      )
      .returning({ id: schema.appUserToken.id });
    const refreshTokens = await tx
      .delete(schema.oauthAppRefreshToken)
      .where(
        and(
          eq(schema.oauthAppRefreshToken.clientId, grant.clientId),
          eq(schema.oauthAppRefreshToken.userId, grant.userId),
        ),
      )
      .returning({ id: schema.oauthAppRefreshToken.id });
    await tx
      .delete(schema.oauthConsent)
      .where(
        and(
          eq(schema.oauthConsent.clientId, grant.clientId),
          eq(schema.oauthConsent.userId, grant.userId),
        ),
      );
    return tokens.length > 0 || refreshTokens.length > 0;
  }
}
