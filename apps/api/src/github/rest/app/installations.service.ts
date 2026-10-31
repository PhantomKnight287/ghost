import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../../database/database.module.js';
import {
  AppJwtError,
  IntegrationForbiddenError,
  UserToServerTokenRequiredError,
} from '../../../lib/apps/apps.errors.js';
import type { UserToServerCaller } from '../../../lib/apps/user-token-context.js';
import { isoTimestamp, sameName } from '../../../lib/db/sql.js';
import { GithubNotFoundError } from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import {
  type Page,
  pageOf,
  toRepositoryRest,
  toUserRest,
} from '../../../lib/github/rest.js';
import {
  acceptedCollaboration,
  grantedTo,
  installationCovers,
  organizationMembership,
  ownerNameOf,
} from '../../../lib/repositories/access/repository-access.js';
import {
  InstallationTokensService,
  type MintTokenBody,
} from '../../../services/apps/installation-tokens.service.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import type { GithubApp, GithubViewer } from '../../auth/github-request.js';
import type {
  GithubInstallationDTO,
  GithubInstallationRepositoriesDTO,
  GithubInstallationTokenDTO,
  GithubUserInstallationsDTO,
} from './dto/installation.dto.js';

const accountUser = alias(schema.user, 'account_user');
const accountOrganization = alias(schema.organization, 'account_organization');
const suspender = alias(schema.user, 'suspender');

/** GitHub's installation endpoints: the app-level ones a JWT calls, and `GET /installation/repositories` for a token. */
@Injectable()
export class GithubInstallationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly tokens: InstallationTokensService,
    private readonly repositoryNodes: RepositoryNodesService,
  ) {}

  list(app: GithubApp | null, query: { page?: unknown; per_page?: unknown }) {
    return this.select(this.appOf(app), undefined, pageOf(query));
  }

  async get(app: GithubApp | null, installationId: number) {
    return this.one(
      this.appOf(app),
      eq(schema.appInstallation.numericId, installationId),
    );
  }

  async remove(app: GithubApp | null, installationId: number) {
    const removed = await this.db
      .delete(schema.appInstallation)
      .where(
        and(
          eq(schema.appInstallation.appId, this.appOf(app)),
          eq(schema.appInstallation.numericId, installationId),
        ),
      )
      .returning({ id: schema.appInstallation.id });
    if (removed.length === 0) throw new GithubNotFoundError();
  }

  async mint(
    app: GithubApp | null,
    installationId: number,
    body: MintTokenBody,
  ): Promise<GithubInstallationTokenDTO> {
    this.appOf(app);
    const minted = await this.tokens.mint(app!, installationId, body);
    return {
      token: minted.token,
      expires_at: minted.expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      permissions:
        minted.permissions as GithubInstallationTokenDTO['permissions'],
      repository_selection: minted.repositorySelection,
    };
  }

  /** The app's installation on the account that owns `owner/repo`, if it covers that repository. */
  forRepository(app: GithubApp | null, owner: string, repo: string) {
    return this.one(
      this.appOf(app),
      sql`exists (select 1 from ${schema.repository} inner join ${schema.user} on ${schema.user.id} = ${schema.repository.ownerId} left join ${schema.organization} on ${schema.organization.id} = ${schema.repository.organizationId} where ${sameName(ownerNameOf(schema.user, schema.organization), owner)} and ${sameName(schema.repository.slug, repo)} and ${installationCovers(schema.repository)})`,
    );
  }

  forUser(app: GithubApp | null, username: string) {
    return this.one(this.appOf(app), sameName(accountUser.username, username));
  }

  forOrganization(app: GithubApp | null, org: string) {
    return this.one(this.appOf(app), sameName(accountOrganization.slug, org));
  }

  /** The repositories the calling token reaches, as the token's bot sees them. */
  async repositories(
    viewer: GithubViewer | null,
    query: { page?: unknown; per_page?: unknown },
  ): Promise<GithubInstallationRepositoriesDTO> {
    const installation = viewer?.installation;
    if (!viewer || !installation) throw new IntegrationForbiddenError();
    const page = pageOf(query);
    const rows = await this.db
      .select({
        id: schema.repository.id,
        selection: schema.appInstallation.repositorySelection,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(schema.repository)
      .innerJoin(
        schema.appInstallation,
        eq(schema.appInstallation.id, installation.installationId),
      )
      .where(
        and(
          installationCovers(schema.repository),
          installation.repositoryIds
            ? inArray(schema.repository.id, installation.repositoryIds)
            : undefined,
        ),
      )
      .orderBy(asc(schema.repository.slug), asc(schema.repository.id))
      .offset(page.offset)
      .limit(page.perPage);
    // ponytail: one authorized load per row, as `GET /user/repos` does.
    const nodes = await Promise.all(
      rows.map((row) => this.repositoryNodes.load(row.id, viewer)),
    );
    const origins = githubOrigins(this.config);
    return {
      total_count: rows[0]?.total ?? 0,
      repository_selection: installation.repositoryIds
        ? 'selected'
        : (rows[0]?.selection ?? 'selected'),
      repositories: nodes.map((node) => toRepositoryRest(node, origins)),
    };
  }

  /** `GET /user/installations`: the installations of the token's app that its user can reach, on their own account or through a repository they can see. */
  async ofUserToken(
    caller: UserToServerCaller | null | undefined,
    query: { page?: unknown; per_page?: unknown },
  ): Promise<GithubUserInstallationsDTO> {
    if (!caller) throw new UserToServerTokenRequiredError();
    const ids = await this.reachableBy(caller);
    const page = pageOf(query);
    return {
      total_count: ids.length,
      installations: ids.length
        ? await this.select(
            caller.appId,
            inArray(schema.appInstallation.id, ids),
            page,
          )
        : [],
    };
  }

  /** `GET /user/installations/{id}/repositories`: the installation's repositories the token's user holds a role on, and a scoped token was narrowed to; a public repository alone is not enough, as on GitHub. */
  async repositoriesOfUserToken(
    caller: UserToServerCaller | null | undefined,
    viewer: GithubViewer | null,
    installationId: number,
    query: { page?: unknown; per_page?: unknown },
  ): Promise<GithubInstallationRepositoriesDTO> {
    if (!caller || !viewer) throw new UserToServerTokenRequiredError();
    const [installation] = await this.db
      .select({
        id: schema.appInstallation.id,
        selection: schema.appInstallation.repositorySelection,
      })
      .from(schema.appInstallation)
      .where(
        and(
          eq(schema.appInstallation.numericId, installationId),
          eq(schema.appInstallation.appId, caller.appId),
        ),
      );
    if (
      !installation ||
      !(await this.reachableBy(caller)).includes(installation.id)
    )
      throw new GithubNotFoundError();
    const page = pageOf(query);
    const actor = { userId: caller.userId };
    const rows = await this.db
      .select({
        id: schema.repository.id,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(schema.repository)
      .innerJoin(
        schema.appInstallation,
        eq(schema.appInstallation.id, installation.id),
      )
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, actor),
      )
      .leftJoin(
        schema.member,
        organizationMembership(schema.repository.organizationId, actor),
      )
      .where(
        and(
          installationCovers(schema.repository),
          grantedTo(actor),
          caller.repositoryIds === null
            ? undefined
            : inArray(schema.repository.id, caller.repositoryIds),
        ),
      )
      .orderBy(asc(schema.repository.slug), asc(schema.repository.id))
      .offset(page.offset)
      .limit(page.perPage);
    const nodes = await Promise.all(
      rows.map((row) => this.repositoryNodes.load(row.id, viewer)),
    );
    const origins = githubOrigins(this.config);
    return {
      total_count: rows[0]?.total ?? 0,
      repository_selection: installation.selection,
      repositories: nodes.map((node) => toRepositoryRest(node, origins)),
    };
  }

  /** Ids of the app's live installations on the user's own account, or covering a repository the user holds a role on: GitHub's "explicit permission" rule, which a public repository alone does not meet. A scoped token reaches only its own installation. */
  private async reachableBy(caller: UserToServerCaller) {
    const actor = { userId: caller.userId };
    const rows = await this.db
      .selectDistinct({ id: schema.appInstallation.id })
      .from(schema.appInstallation)
      .leftJoin(schema.repository, installationCovers(schema.repository))
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, actor),
      )
      .leftJoin(
        schema.member,
        organizationMembership(schema.repository.organizationId, actor),
      )
      .where(
        and(
          eq(schema.appInstallation.appId, caller.appId),
          isNull(schema.appInstallation.suspendedAt),
          caller.installationId === null
            ? undefined
            : eq(schema.appInstallation.id, caller.installationId),
          or(
            eq(schema.appInstallation.accountUserId, caller.userId),
            and(isNotNull(schema.repository.id), grantedTo(actor)),
          ),
        ),
      );
    return rows.map(({ id }) => id);
  }

  /** A JWT is the only way in; anything else gets GitHub's answer to a token that is not one. */
  private appOf(app: GithubApp | null) {
    if (!app) throw new AppJwtError();
    return app.appId;
  }

  private async one(appId: string, where: SQL) {
    const [installation] = await this.select(appId, where, {
      page: 1,
      perPage: 1,
      offset: 0,
    });
    if (!installation) throw new GithubNotFoundError();
    return installation;
  }

  private async select(
    appId: string,
    where: SQL | undefined,
    page: Page,
  ): Promise<GithubInstallationDTO[]> {
    const origins = githubOrigins(this.config);
    const installation = schema.appInstallation;
    const rows = await this.db
      .select({
        id: installation.numericId,
        appId: schema.app.numericId,
        appSlug: schema.app.slug,
        repositorySelection: installation.repositorySelection,
        permissions: installation.permissions,
        events: installation.events,
        createdAt: isoTimestamp(installation.createdAt),
        updatedAt: isoTimestamp(installation.updatedAt),
        suspendedAt: sql<
          string | null
        >`case when ${installation.suspendedAt} is null then null else ${isoTimestamp(installation.suspendedAt)} end`,
        account: {
          ghostId: sql<string>`coalesce(${accountOrganization.id}, ${accountUser.id})`,
          numericId: sql<number>`coalesce(${accountOrganization.numericId}, ${accountUser.numericId})`,
          login: sql<string>`coalesce(${accountOrganization.slug}, ${accountUser.username})`,
          avatarUrl: sql<
            string | null
          >`coalesce(${accountOrganization.logo}, ${accountUser.image})`,
          isOrganization: sql<boolean>`${accountOrganization.id} is not null`,
        },
        suspendedBy: {
          ghostId: suspender.id,
          numericId: suspender.numericId,
          login: suspender.username,
          avatarUrl: suspender.image,
        },
      })
      .from(installation)
      .innerJoin(schema.app, eq(schema.app.id, installation.appId))
      .leftJoin(accountUser, eq(accountUser.id, installation.accountUserId))
      .leftJoin(
        accountOrganization,
        eq(accountOrganization.id, installation.accountOrganizationId),
      )
      .leftJoin(suspender, eq(suspender.id, installation.suspendedById))
      .where(
        and(eq(installation.appId, appId), isNull(schema.app.deletedAt), where),
      )
      .orderBy(asc(installation.numericId))
      .offset(page.offset)
      .limit(page.perPage);
    return rows.map(({ account, suspendedBy, ...row }) => {
      const type = account.isOrganization ? 'Organization' : 'User';
      const url = `${origins.api}/api/v3/app/installations/${row.id}`;
      return {
        id: row.id,
        account: toUserRest(account, origins, type),
        repository_selection: row.repositorySelection,
        access_tokens_url: `${url}/access_tokens`,
        repositories_url: `${origins.api}/api/v3/installation/repositories`,
        html_url: `${origins.web}${account.isOrganization ? `/${account.login}` : ''}/settings/installations`,
        app_id: row.appId,
        app_slug: row.appSlug,
        target_id: account.numericId,
        target_type: type,
        permissions: row.permissions as GithubInstallationDTO['permissions'],
        events: row.events,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        single_file_name: null,
        suspended_at: row.suspendedAt,
        suspended_by: suspendedBy?.login
          ? toUserRest({ ...suspendedBy, login: suspendedBy.login }, origins)
          : null,
      };
    });
  }
}
