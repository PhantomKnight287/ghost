import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { hashUserToken } from '../../../lib/apps/user-token.js';
import { GithubNotFoundError } from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { toUserRest } from '../../../lib/github/rest.js';
import { AppClientsService } from '../../../services/apps/app-clients.service.js';
import { UserTokensService } from '../../../services/apps/user-tokens.service.js';
import type { GithubAuthorizationDTO } from './dto/installation.dto.js';

/** GitHub's `/applications/{client_id}` routes for a Ghost App's `ghu_` tokens, behind HTTP Basic with the app's client id and one of its secrets. Any mismatch is a 404, as on GitHub. */
@Injectable()
export class GithubApplicationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly clients: AppClientsService,
    private readonly tokens: UserTokensService,
  ) {}

  async check(
    clientId: string,
    authorization: string | undefined,
    accessToken: string,
  ): Promise<GithubAuthorizationDTO> {
    const appId = await this.appOf(clientId, authorization);
    const token = await this.tokens.lookup(appId, accessToken);
    if (!token) throw new GithubNotFoundError();
    const [row] = await this.db
      .select({
        appName: schema.app.name,
        homepageUrl: schema.app.homepageUrl,
        ghostId: schema.user.id,
        numericId: schema.user.numericId,
        login: schema.user.username,
        avatarUrl: schema.user.image,
      })
      .from(schema.app)
      .innerJoin(schema.user, eq(schema.user.id, token.userId))
      .where(eq(schema.app.id, appId));
    if (!row?.login) throw new GithubNotFoundError();
    const origins = githubOrigins(this.config);
    return {
      id: token.id,
      url: `${origins.api}/api/v3/authorizations/${token.id}`,
      scopes: [],
      token: accessToken,
      token_last_eight: accessToken.slice(-8),
      hashed_token: hashUserToken(accessToken),
      app: { client_id: clientId, name: row.appName, url: row.homepageUrl },
      note: null,
      note_url: null,
      fingerprint: null,
      created_at: token.createdAt.toISOString(),
      updated_at: token.createdAt.toISOString(),
      expires_at: token.expiresAt?.toISOString() ?? null,
      user: toUserRest({ ...row, login: row.login }, origins),
    };
  }

  async revoke(
    clientId: string,
    authorization: string | undefined,
    accessToken: string,
  ) {
    const appId = await this.appOf(clientId, authorization);
    if (!(await this.tokens.revokeToken(appId, accessToken)))
      throw new GithubNotFoundError();
  }

  /** Ends the authorization of the user the token belongs to: every token, refresh token and the consent. */
  async revokeGrant(
    clientId: string,
    authorization: string | undefined,
    accessToken: string,
  ) {
    const appId = await this.appOf(clientId, authorization);
    const token = await this.tokens.lookup(appId, accessToken);
    if (!token) throw new GithubNotFoundError();
    await this.db.transaction((tx) =>
      this.tokens.revokeUser(tx, { appId, clientId, userId: token.userId }),
    );
  }

  private async appOf(clientId: string, authorization: string | undefined) {
    const decoded = authorization?.startsWith('Basic ')
      ? Buffer.from(authorization.slice(6), 'base64').toString('utf8')
      : '';
    const separator = decoded.indexOf(':');
    if (separator < 0 || decoded.slice(0, separator) !== clientId)
      throw new GithubNotFoundError();
    const app = await this.clients.authenticate(
      clientId,
      decoded.slice(separator + 1),
    );
    if (!app) throw new GithubNotFoundError();
    return app.appId;
  }
}
