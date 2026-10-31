import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, or } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import {
  InstallationRepositoriesError,
  ScopedTokenTargetError,
} from '../../../lib/apps/apps.errors.js';
import { narrowPermissions } from '../../../lib/apps/installation-token.js';
import { narrowRepositories } from '../../../lib/apps/narrow-repositories.js';
import { hashUserToken } from '../../../lib/apps/user-token.js';
import { sameName } from '../../../lib/db/sql.js';
import { GithubNotFoundError } from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { toUserRest } from '../../../lib/github/rest.js';
import { AppClientsService } from '../../../services/apps/app-clients.service.js';
import { InstallationAccessService } from '../../../services/apps/installation-access.service.js';
import { UserTokensService } from '../../../services/apps/user-tokens.service.js';
import type {
  GithubAuthorizationDTO,
  GithubScopedTokenRequestDTO,
} from './dto/installation.dto.js';

/** GitHub's `/applications/{client_id}` routes for a Ghost App's `ghu_` tokens, behind HTTP Basic with the app's client id and one of its secrets. Any mismatch is a 404, as on GitHub. */
@Injectable()
export class GithubApplicationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly clients: AppClientsService,
    private readonly tokens: UserTokensService,
    private readonly installations: InstallationAccessService,
  ) {}

  async check(
    clientId: string,
    authorization: string | undefined,
    accessToken: string,
  ): Promise<GithubAuthorizationDTO> {
    const appId = await this.appOf(clientId, authorization);
    return this.authorization(clientId, appId, accessToken);
  }

  async reset(
    clientId: string,
    authorization: string | undefined,
    accessToken: string,
  ): Promise<GithubAuthorizationDTO> {
    const appId = await this.appOf(clientId, authorization);
    const reset = await this.tokens.reset(appId, accessToken);
    if (!reset) throw new GithubNotFoundError();
    return this.authorization(clientId, appId, reset.token);
  }

  /** A new token limited to one installation's account, some of its repositories and fewer permissions, never more than the original, which keeps working. */
  async scoped(
    clientId: string,
    authorization: string | undefined,
    body: GithubScopedTokenRequestDTO,
  ): Promise<GithubAuthorizationDTO> {
    const appId = await this.appOf(clientId, authorization);
    const original = await this.tokens.lookup(appId, body.access_token);
    if (!original) throw new GithubNotFoundError();
    const targeted = body.target != null || body.target_id != null;
    if (!targeted && (body.repositories?.length || body.repository_ids?.length))
      throw new ScopedTokenTargetError();
    const installationId = targeted
      ? await this.installationOn(appId, body)
      : original.installationId;
    if (original.installationId && installationId !== original.installationId)
      throw new ScopedTokenTargetError();
    const permissions = body.permissions
      ? narrowPermissions(
          original.permissions ??
            (await this.installations.appPermissions(appId)),
          body.permissions,
        )
      : original.permissions;
    const repositoryIds =
      (installationId &&
        (await narrowRepositories(this.db, installationId, body))) ||
      original.repositoryIds;
    if (
      original.repositoryIds &&
      repositoryIds?.some((id) => !original.repositoryIds!.includes(id))
    )
      throw new InstallationRepositoriesError();
    const { token } = await this.tokens.mint(this.db, {
      appId,
      userId: original.userId,
      expires: original.expiresAt !== null,
      scope: { installationId, permissions, repositoryIds },
    });
    return this.authorization(clientId, appId, token);
  }

  private async installationOn(
    appId: string,
    { target, target_id }: GithubScopedTokenRequestDTO,
  ) {
    const [installation] = await this.db
      .select({ id: schema.appInstallation.id })
      .from(schema.appInstallation)
      .leftJoin(
        schema.user,
        eq(schema.user.id, schema.appInstallation.accountUserId),
      )
      .leftJoin(
        schema.organization,
        eq(
          schema.organization.id,
          schema.appInstallation.accountOrganizationId,
        ),
      )
      .where(
        and(
          eq(schema.appInstallation.appId, appId),
          target != null
            ? or(
                sameName(schema.user.username, target),
                sameName(schema.organization.slug, target),
              )
            : or(
                eq(schema.user.numericId, target_id!),
                eq(schema.organization.numericId, target_id!),
              ),
        ),
      );
    if (!installation) throw new ScopedTokenTargetError();
    return installation.id;
  }

  private async authorization(
    clientId: string,
    appId: string,
    accessToken: string,
  ): Promise<GithubAuthorizationDTO> {
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
