import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { UserToServerCaller } from '../../lib/apps/user-token-context.js';
import { generateUserToken, hashUserToken } from '../../lib/apps/user-token.js';
import type { Executor } from '../../lib/db/executor.js';
import { ACCESS_TOKEN_EXPIRES_IN } from '../../lib/github/refresh-tokens.js';

/** `ghu_` tokens: a user signed in to a Ghost App, which then acts as them. Only the sha256 is kept. */
@Injectable()
export class UserTokensService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The token leaves in this response and nowhere else. `expires` follows the app's "Expire user authorization tokens". */
  async mint(
    executor: Executor,
    grant: { appId: string; userId: string; expires: boolean },
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
}
