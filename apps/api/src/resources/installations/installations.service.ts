import { type Database, schema } from '@ghost/db';
import type { AppPermissions } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../database/database.module.js';
import {
  AlreadyInstalledError,
  AppNotFoundError,
  InstallationNotFoundError,
  InstallationRepositoryError,
} from '../../lib/apps/apps.errors.js';
import { withMetadata } from '../../lib/apps/permissions.js';
import type { Executor } from '../../lib/db/executor.js';
import { isoTimestamp, sameName } from '../../lib/db/sql.js';
import { githubOrigins } from '../../lib/github/origins.js';
import { administeredOrganization } from '../../lib/organizations/administered-organization.js';
import { repositoryFullNameOf } from '../../lib/repositories/access/repository-access.js';
import type {
  CreateInstallationDTO,
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

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService,
  ) {
    this.web = githubOrigins(config).web;
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
      await tx
        .update(schema.appInstallation)
        .set({ repositorySelection: input.repositorySelection })
        .where(eq(schema.appInstallation.id, id));
      await tx
        .delete(schema.appInstallationRepository)
        .where(eq(schema.appInstallationRepository.installationId, id));
      await this.selectRepositories(tx, id, account, input);
    });
    return this.one(id);
  }

  /** Every token of the installation stops working at once. */
  async suspend(userId: string, id: string): Promise<void> {
    await this.manageable(userId, id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.appInstallation)
        .set({ suspendedAt: new Date(), suspendedById: userId })
        .where(eq(schema.appInstallation.id, id));
      await tx
        .delete(schema.appInstallationToken)
        .where(eq(schema.appInstallationToken.installationId, id));
    });
  }

  async unsuspend(userId: string, id: string): Promise<void> {
    await this.manageable(userId, id);
    await this.db
      .update(schema.appInstallation)
      .set({ suspendedAt: null, suspendedById: null })
      .where(eq(schema.appInstallation.id, id));
  }

  async uninstall(userId: string, id: string): Promise<void> {
    await this.manageable(userId, id);
    await this.db
      .delete(schema.appInstallation)
      .where(eq(schema.appInstallation.id, id));
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

  /** Installations of live apps matching `where`, oldest first. */
  private select(where: SQL): Promise<InstallationDTO[]> {
    const installation = schema.appInstallation;
    const settings = sql<string>`${this.web} || coalesce('/' || ${accountOrganization.slug}, '') || '/settings/installations'`;
    return this.db
      .select({
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
        suspendedAt: sql<
          string | null
        >`case when ${installation.suspendedAt} is null then null else ${isoTimestamp(installation.suspendedAt)} end`,
        createdAt: isoTimestamp(installation.createdAt),
        redirectUrl: sql<string>`case when ${schema.app.setupUrl} is null then ${settings} else ${schema.app.setupUrl} || case when position('?' in ${schema.app.setupUrl}) > 0 then '&' else '?' end || 'installation_id=' || ${installation.numericId} || '&setup_action=install' end`,
      })
      .from(installation)
      .innerJoin(schema.app, eq(schema.app.id, installation.appId))
      .leftJoin(accountUser, eq(accountUser.id, installation.accountUserId))
      .leftJoin(
        accountOrganization,
        eq(accountOrganization.id, installation.accountOrganizationId),
      )
      .where(and(where, isNull(schema.app.deletedAt)))
      .orderBy(asc(installation.createdAt));
  }
}
