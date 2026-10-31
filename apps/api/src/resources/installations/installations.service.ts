import { type Database, schema } from '@ghost/db';
import type { AppPermission, AppPermissions } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../database/database.module.js';
import {
  AlreadyInstalledError,
  AppNotFoundError,
  InstallationNotFoundError,
  InstallationRepositoryError,
} from '../../lib/apps/apps.errors.js';
import { grants, withMetadata } from '../../lib/apps/permissions.js';
import type { Executor } from '../../lib/db/executor.js';
import { isoTimestamp, sameName } from '../../lib/db/sql.js';
import { githubOrigins } from '../../lib/github/origins.js';
import { administeredOrganization } from '../../lib/organizations/administered-organization.js';
import {
  installationCovers,
  repositoryFullNameOf,
} from '../../lib/repositories/access/repository-access.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { WebhookFanoutService } from '../../services/webhooks/webhook-fanout.service.js';
import type {
  CreateInstallationDTO,
  InstallationAppDTO,
  InstallationDTO,
  InstallationRepositoryDTO,
  ListInstallationsResponseDTO,
  UpdateInstallationDTO,
} from './dto/installation.dto.js';

type Account =
  | { accountUserId: string; accountOrganizationId: null }
  | { accountUserId: null; accountOrganizationId: string };

const accountUser = alias(schema.user, 'account_user');
const accountOrganization = alias(schema.organization, 'account_organization');

/** Installations of Ghost Apps, as the accounts they are installed on manage them. */
@Injectable()
export class InstallationsService {
  private readonly web: string;
  private readonly api: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly fanout: WebhookFanoutService,
    config: ConfigService,
  ) {
    this.web = githubOrigins(config).web;
    this.api = githubOrigins(config).api;
  }

  /** Installs on the caller's own account, or on an organization they administer. The installation accepts the app's permissions and events as they are now. */
  async install(
    userId: string,
    slug: string,
    input: CreateInstallationDTO,
  ): Promise<InstallationDTO> {
    const [app] = await this.db
      .select({
        id: schema.app.id,
        permissions: schema.app.permissions,
        events: schema.app.events,
      })
      .from(schema.app)
      .where(and(eq(schema.app.slug, slug), isNull(schema.app.deletedAt)));
    if (!app) throw new AppNotFoundError();
    const account = await this.accountOf(userId, input.account);

    const id = await this.db
      .transaction(async (tx) => {
        const [installation] = await tx
          .insert(schema.appInstallation)
          .values({
            appId: app.id,
            ...account,
            repositorySelection: input.repositorySelection,
            permissions: withMetadata(app.permissions as AppPermissions),
            events: app.events,
            installedById: userId,
          })
          .returning({ id: schema.appInstallation.id });
        await this.selectRepositories(tx, installation!.id, account, input);
        await this.fanout.installationEvent(
          tx,
          installation!.id,
          'installation.created',
          userId,
          input.repositorySelection === 'selected' ? input.repositoryIds : [],
        );
        return installation!.id;
      })
      .catch((error: unknown) => {
        if ((error as { cause?: { code?: string } }).cause?.code === '23505')
          throw new AlreadyInstalledError();
        throw error;
      });
    return this.one(id);
  }

  async list(userId: string): Promise<ListInstallationsResponseDTO> {
    return {
      installations: await this.select(
        eq(schema.appInstallation.accountUserId, userId),
      ),
    };
  }

  async listForOrganization(
    slug: string,
    userId: string,
  ): Promise<ListInstallationsResponseDTO> {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      userId,
    );
    return {
      installations: await this.select(
        eq(schema.appInstallation.accountOrganizationId, organizationId),
      ),
    };
  }

  async update(
    userId: string,
    id: string,
    input: UpdateInstallationDTO,
  ): Promise<InstallationDTO> {
    const account = await this.manageable(userId, id);
    await this.db.transaction(async (tx) => {
      const before = await coveredBy(tx, id);
      await tx
        .update(schema.appInstallation)
        .set({ repositorySelection: input.repositorySelection })
        .where(eq(schema.appInstallation.id, id));
      await tx
        .delete(schema.appInstallationRepository)
        .where(eq(schema.appInstallationRepository.installationId, id));
      await this.selectRepositories(tx, id, account, input);

      const [{ suspendedAt } = { suspendedAt: null }] = await tx
        .select({ suspendedAt: schema.appInstallation.suspendedAt })
        .from(schema.appInstallation)
        .where(eq(schema.appInstallation.id, id));
      // a suspended installation hears nothing until it is unsuspended
      if (suspendedAt) return;
      const after = await coveredBy(tx, id);
      const added = [...after].filter((repository) => !before.has(repository));
      const removed = [...before].filter(
        (repository) => !after.has(repository),
      );
      if (added.length > 0)
        await this.fanout.installationEvent(
          tx,
          id,
          'installation.repositories_added',
          userId,
          added,
        );
      if (removed.length > 0)
        await this.fanout.installationEvent(
          tx,
          id,
          'installation.repositories_removed',
          userId,
          removed,
        );
    });
    return this.one(id);
  }

  /** The live apps installed where they reach the repository, for its admins to name in rulesets. */
  async forRepository(
    userId: string,
    username: string,
    repo: string,
  ): Promise<{ apps: InstallationAppDTO[] }> {
    const repository = await this.access.authorize({
      username,
      repo,
      requesterId: userId,
      operation: 'admin',
    });
    const apps = await this.db
      .select({
        appId: schema.app.numericId,
        slug: schema.app.slug,
        name: schema.app.name,
        logoUrl: schema.app.logoUrl,
      })
      .from(schema.repository)
      .innerJoin(schema.appInstallation, installationCovers(schema.repository))
      .innerJoin(schema.app, eq(schema.app.id, schema.appInstallation.appId))
      .where(
        and(
          eq(schema.repository.id, repository.id),
          isNull(schema.app.deletedAt),
        ),
      )
      .orderBy(asc(schema.app.name));
    return { apps };
  }

  /** Every token of the installation stops working at once. */
  async suspend(userId: string, id: string): Promise<void> {
    await this.manageable(userId, id);
    await this.db.transaction(async (tx) => {
      const changed = await tx
        .update(schema.appInstallation)
        .set({ suspendedAt: new Date(), suspendedById: userId })
        .where(
          and(
            eq(schema.appInstallation.id, id),
            isNull(schema.appInstallation.suspendedAt),
          ),
        )
        .returning({ id: schema.appInstallation.id });
      // already suspended: nothing changes and the app hears nothing
      if (changed.length === 0) return;
      await tx
        .delete(schema.appInstallationToken)
        .where(eq(schema.appInstallationToken.installationId, id));
      await this.fanout.installationEvent(
        tx,
        id,
        'installation.suspended',
        userId,
      );
    });
  }

  async unsuspend(userId: string, id: string): Promise<void> {
    await this.manageable(userId, id);
    await this.db.transaction(async (tx) => {
      const changed = await tx
        .update(schema.appInstallation)
        .set({ suspendedAt: null, suspendedById: null })
        .where(
          and(
            eq(schema.appInstallation.id, id),
            isNotNull(schema.appInstallation.suspendedAt),
          ),
        )
        .returning({ id: schema.appInstallation.id });
      if (changed.length === 0) return;
      await this.fanout.installationEvent(
        tx,
        id,
        'installation.unsuspended',
        userId,
      );
    });
  }

  /** The installation takes the app's permissions and events as they are now. */
  async acceptPermissions(userId: string, id: string): Promise<void> {
    await this.manageable(userId, id);
    await this.db.transaction(async (tx) => {
      const [app] = await tx
        .select({
          permissions: schema.app.permissions,
          events: schema.app.events,
          acceptedPermissions: schema.appInstallation.permissions,
          acceptedEvents: schema.appInstallation.events,
        })
        .from(schema.appInstallation)
        .innerJoin(schema.app, eq(schema.app.id, schema.appInstallation.appId))
        .where(eq(schema.appInstallation.id, id))
        .for('update', { of: schema.appInstallation });
      if (!app || !isPending(app)) return;
      await tx
        .update(schema.appInstallation)
        .set({
          permissions: withMetadata(app.permissions as AppPermissions),
          events: app.events,
        })
        .where(eq(schema.appInstallation.id, id));
      await this.fanout.installationEvent(
        tx,
        id,
        'installation.new_permissions_accepted',
        userId,
      );
    });
  }

  async uninstall(userId: string, id: string): Promise<void> {
    await this.manageable(userId, id);
    await this.db.transaction(async (tx) => {
      // queued first, while the installation can still be read; the endpoint is the app's and outlives it
      await this.fanout.installationEvent(
        tx,
        id,
        'installation.deleted',
        userId,
      );
      await tx
        .delete(schema.appInstallation)
        .where(eq(schema.appInstallation.id, id));
    });
  }

  /** `login` names the caller, or an organization they administer; anything else is a 404. */
  private async accountOf(userId: string, login: string): Promise<Account> {
    const [self] = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(
        and(eq(schema.user.id, userId), sameName(schema.user.username, login)),
      );
    if (self) return { accountUserId: userId, accountOrganizationId: null };
    const { organizationId } = await administeredOrganization(
      this.db,
      login,
      userId,
    );
    return { accountUserId: null, accountOrganizationId: organizationId };
  }

  private async selectRepositories(
    tx: Executor,
    installationId: string,
    account: Account,
    input: UpdateInstallationDTO,
  ) {
    if (input.repositorySelection !== 'selected') return;
    const ids = [...new Set(input.repositoryIds)];
    const owned = await tx
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .where(
        and(
          inArray(schema.repository.id, ids),
          account.accountUserId === null
            ? eq(
                schema.repository.organizationId,
                account.accountOrganizationId,
              )
            : and(
                eq(schema.repository.ownerId, account.accountUserId),
                isNull(schema.repository.organizationId),
              ),
        ),
      );
    if (owned.length !== ids.length) throw new InstallationRepositoryError();
    await tx
      .insert(schema.appInstallationRepository)
      .values(ids.map((repositoryId) => ({ installationId, repositoryId })));
  }

  /** The account behind an installation, if `userId` is it or administers it. Anyone else gets a 404, so installations of others stay unseen. */
  private async manageable(userId: string, id: string): Promise<Account> {
    const [installation] = await this.db
      .select({
        accountUserId: schema.appInstallation.accountUserId,
        accountOrganizationId: schema.appInstallation.accountOrganizationId,
        organization: accountOrganization.slug,
      })
      .from(schema.appInstallation)
      .leftJoin(
        accountOrganization,
        eq(
          accountOrganization.id,
          schema.appInstallation.accountOrganizationId,
        ),
      )
      .where(eq(schema.appInstallation.id, id));
    if (!installation) throw new InstallationNotFoundError();
    if (installation.organization) {
      await administeredOrganization(
        this.db,
        installation.organization,
        userId,
      );
      return {
        accountUserId: null,
        accountOrganizationId: installation.accountOrganizationId!,
      };
    }
    if (installation.accountUserId !== userId)
      throw new InstallationNotFoundError();
    return { accountUserId: userId, accountOrganizationId: null };
  }

  private async one(id: string): Promise<InstallationDTO> {
    const [installation] = await this.select(eq(schema.appInstallation.id, id));
    if (!installation) throw new InstallationNotFoundError();
    return installation;
  }

  /** Installations of live apps matching `where`, oldest first. An app that asks for user authorization during installation sends the installer through the web flow to its first callback, which gets `installation_id` and `setup_action` as GitHub sends them. */
  private async select(where: SQL): Promise<InstallationDTO[]> {
    const installation = schema.appInstallation;
    const settings = sql<string>`${this.web} || coalesce('/' || ${accountOrganization.slug}, '') || '/settings/installations'`;
    const rows = await this.db
      .select({
        clientId: schema.app.oauthClientId,
        callback: sql<
          string | null
        >`case when ${schema.app.requestOauthOnInstall} then ${schema.oauthClient.redirectUris}[1] end`,
        id: installation.id,
        installationId: installation.numericId,
        app: sql<
          InstallationDTO['app']
        >`json_build_object('appId', ${schema.app.numericId}, 'slug', ${schema.app.slug}, 'name', ${schema.app.name}, 'logoUrl', ${schema.app.logoUrl})`,
        account: sql<
          InstallationDTO['account']
        >`json_build_object('login', coalesce(${accountOrganization.slug}, ${accountUser.username}), 'type', case when ${installation.accountOrganizationId} is null then 'user' else 'organization' end)`,
        repositorySelection: installation.repositorySelection,
        repositories: sql<
          InstallationRepositoryDTO[]
        >`coalesce((select json_agg(json_build_object('id', ${schema.repository.id}, 'fullName', ${repositoryFullNameOf(schema.user, schema.organization, schema.repository)}) order by ${schema.repository.slug}) from ${schema.appInstallationRepository} inner join ${schema.repository} on ${schema.repository.id} = ${schema.appInstallationRepository.repositoryId} inner join ${schema.user} on ${schema.user.id} = ${schema.repository.ownerId} left join ${schema.organization} on ${schema.organization.id} = ${schema.repository.organizationId} where ${schema.appInstallationRepository.installationId} = ${installation.id}), '[]'::json)`,
        permissions: installation.permissions,
        events: installation.events,
        appPermissions: schema.app.permissions,
        appEvents: schema.app.events,
        suspendedAt: sql<
          string | null
        >`case when ${installation.suspendedAt} is null then null else ${isoTimestamp(installation.suspendedAt)} end`,
        createdAt: isoTimestamp(installation.createdAt),
        redirectUrl: sql<string>`case when ${schema.app.setupUrl} is null then ${settings} else ${schema.app.setupUrl} || case when position('?' in ${schema.app.setupUrl}) > 0 then '&' else '?' end || 'installation_id=' || ${installation.numericId} || '&setup_action=install' end`,
      })
      .from(installation)
      .innerJoin(schema.app, eq(schema.app.id, installation.appId))
      .leftJoin(
        schema.oauthClient,
        eq(schema.oauthClient.clientId, schema.app.oauthClientId),
      )
      .leftJoin(accountUser, eq(accountUser.id, installation.accountUserId))
      .leftJoin(
        accountOrganization,
        eq(accountOrganization.id, installation.accountOrganizationId),
      )
      .where(and(where, isNull(schema.app.deletedAt)))
      .orderBy(asc(installation.createdAt));
    return rows.map(({ clientId, callback, appPermissions, appEvents, ...row }) => {
      const pending = isPending({
        permissions: appPermissions,
        events: appEvents,
        acceptedPermissions: row.permissions,
        acceptedEvents: row.events,
      })
        ? {
            permissions: withMetadata(appPermissions as AppPermissions),
            events: appEvents,
          }
        : null;
      if (!clientId || !callback) return { ...row, pending };
      const returnTo = new URL(callback);
      returnTo.searchParams.set('installation_id', String(row.installationId));
      returnTo.searchParams.set('setup_action', 'install');
      const authorize = new URL('/login/oauth/authorize', this.api);
      authorize.searchParams.set('client_id', clientId);
      authorize.searchParams.set('redirect_uri', returnTo.href);
      return { ...row, pending, redirectUrl: authorize.href };
    });
  }
}

/** Whether the app asks for anything its installation has not accepted. */
function isPending(grant: {
  permissions: Record<string, string>;
  events: string[];
  acceptedPermissions: AppPermissions;
  acceptedEvents: string[];
}) {
  return (
    Object.entries(grant.permissions).some(
      ([name, level]) =>
        !grants(
          grant.acceptedPermissions,
          name as AppPermission,
          level as 'read' | 'write',
        ),
    ) || grant.events.some((event) => !grant.acceptedEvents.includes(event))
  );
}

/** The repositories an installation covers now. */
async function coveredBy(tx: Executor, installationId: string) {
  const rows = await tx
    .select({ id: schema.repository.id })
    .from(schema.repository)
    .innerJoin(schema.appInstallation, installationCovers(schema.repository))
    .where(eq(schema.appInstallation.id, installationId));
  return new Set(rows.map(({ id }) => id));
}
