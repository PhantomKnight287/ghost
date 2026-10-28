import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { decodeAppJwt, verifyAppJwt } from '../../lib/apps/app-jwt.js';
import { AppJwtError } from '../../lib/apps/apps.errors.js';

/** The live app whose private key signed a JWT. An unknown or deleted app reads as an undecodable token, as on GitHub. */
@Injectable()
export class AppJwtService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async verify(token: string): Promise<{ appId: string; numericId: number }> {
    const claims = decodeAppJwt(token);
    const keys = await this.db
      .select({
        appId: schema.app.id,
        publicKey: schema.appPublicKey.publicKey,
      })
      .from(schema.app)
      .innerJoin(
        schema.appPublicKey,
        eq(schema.appPublicKey.appId, schema.app.id),
      )
      .where(
        and(eq(schema.app.numericId, claims.iss), isNull(schema.app.deletedAt)),
      );
    if (keys.length === 0) throw new AppJwtError();
    verifyAppJwt(
      token,
      claims,
      keys.map(({ publicKey }) => publicKey),
      Math.floor(Date.now() / 1000),
    );
    return { appId: keys[0]!.appId, numericId: claims.iss };
  }
}
