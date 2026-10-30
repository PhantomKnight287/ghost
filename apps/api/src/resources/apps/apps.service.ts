import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import { type Database, schema } from '@ghost/db';
import {
  type AppPermission,
  type AppPermissions,
  appSlug,
} from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  AppNameTakenError,
  AppNameUnusableError,
  AppNotFoundError,
  AppSlugReservedError,
  AppWebhookSecretRequiredError,
  InvalidAppPermissionsError,
  PermissionRaiseError,
  PrivateKeyNotFoundError,
  TooManyPrivateKeysError,
} from '../../lib/apps/apps.errors.js';
import { deleteApps } from '../../lib/apps/delete-apps.js';
import {
  appPermissionsProblem,
  grants,
  withMetadata,
} from '../../lib/apps/permissions.js';

import type { Executor } from '../../lib/db/executor.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import { githubOrigins } from '../../lib/github/origins.js';
import { administeredOrganization } from '../../lib/organizations/administered-organization.js';
import {
  InvalidWebhookUrlError,
  WebhooksNotConfiguredError,
} from '../../lib/webhooks/webhooks.errors.js';
import {
  sealWebhookSecret,
  type WebhookOwner,
  webhookSecretKey,
  webhookUrlProblem,
} from '../../lib/webhooks/webhooks.js';
import { AvatarStorageService } from '../../services/avatars/avatar-storage.service.js';
import { WebhookFanoutService } from '../../services/webhooks/webhook-fanout.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import type {
  AppDTO,
  AppOwnerDTO,
  AppPrivateKeyDTO,
  CreateAppDTO,
  CreatedPrivateKeyDTO,
  ListAppsResponseDTO,
  PublicAppDTO,
  UpdateAppDTO,
} from './dto/app.dto.js';

const MAX_PRIVATE_KEYS = 20;

/** Ghost Apps a user or an organization registers. Each owns a bot user, `slug[bot]`, created with it and kept after it is deleted. */
@Injectable()
export class AppsService {
  private readonly web: string;
  private readonly webhookKey: Buffer | undefined;
  private readonly allowPrivateWebhooks: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly avatars: AvatarStorageService,
    private readonly webhooks: WebhooksService,
    private readonly fanout: WebhookFanoutService,
    config: ConfigService,
  ) {
    this.web = githubOrigins(config).web;
    this.webhookKey = webhookSecretKey(
      config.get<string>('WEBHOOK_SECRET_KEY'),
    );
    this.allowPrivateWebhooks =
      config.get<string>('WEBHOOK_ALLOW_PRIVATE_NETWORKS') === 'true';
  }

  async list(userId: string): Promise<ListAppsResponseDTO> {
    return { apps: await this.select(eq(schema.app.ownerUserId, userId)) };
  }

  async listForOrganization(
    slug: string,
    userId: string,
  ): Promise<ListAppsResponseDTO> {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      userId,
    );
    return {
      apps: await this.select(
        eq(schema.app.ownerOrganizationId, organizationId),
      ),
    };
  }

  async get(userId: string, slug: string): Promise<AppDTO> {
    const { id } = await this.manageable(userId, slug);
    return this.one(id);
  }

  async describe(slug: string): Promise<PublicAppDTO> {
    const [app] = await this.db
      .select(this.publicColumns())
      .from(schema.app)
      .leftJoin(schema.user, eq(schema.user.id, schema.app.ownerUserId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.app.ownerOrganizationId),
      )
      .where(and(eq(schema.app.slug, slug), isNull(schema.app.deletedAt)));
    if (!app) throw new AppNotFoundError();
    return app;
  }

  /** Registers an app for the user, or for the organization behind `organization` when they administer it. */
  async create(
    userId: string,
    input: CreateAppDTO,
    organization?: string,
  ): Promise<AppDTO> {
    const organizationId = organization
      ? (await administeredOrganization(this.db, organization, userId))
          .organizationId
      : null;
    const problem = appPermissionsProblem(input.permissions, input.events);
    if (problem) throw new InvalidAppPermissionsError(problem);
    const slug = appSlug(input.name);
    if (!slug) throw new AppNameUnusableError();
    if (slug === 'new') throw new AppSlugReservedError();
    const webhook = await this.webhookOf(
      input.webhookUrl ?? null,
      this.sealed(input.webhookSecret),
    );

    const id = await this.db
      .transaction(async (tx) => {
        const botUserId = randomUUID();
        await tx.insert(schema.user).values({
          id: botUserId,
          kind: 'bot',
          name: input.name,
          username: `${slug}[bot]`,
          displayUsername: `${slug}[bot]`,
          // `.invalid` never resolves (RFC 2606), so no mail reaches anyone and no sign-in by email can find the bot.
          email: `${slug}[bot]@bots.invalid`,
        });
        const [app] = await tx
          .insert(schema.app)
          .values({
            slug,
            name: input.name,
            description: input.description ?? null,
            homepageUrl: input.homepageUrl,
            setupUrl: input.setupUrl ?? null,
            // appPermissionsProblem has checked every key and level.
            permissions: input.permissions as AppPermissions,
            events: [...new Set(input.events)],
            ownerUserId: organizationId ? null : userId,
            ownerOrganizationId: organizationId,
            botUserId,
          })
          .returning({ id: schema.app.id });
        if (webhook)
          await tx
            .insert(schema.webhookEndpoint)
            .values({ appId: app!.id, ...webhook, events: [] });
        return app!.id;
      })
      .catch((error: unknown) => {
        // The slug, the bot's username and its email are all made from the name, so any of them taken means the name is; deleted apps keep theirs.
        if ((error as { cause?: { code?: string } }).cause?.code === '23505')
          throw new AppNameTakenError();
        throw error;
      });
    if (webhook) await this.ping(id, slug);
    return this.one(id);
  }

  async update(
    userId: string,
    slug: string,
    input: UpdateAppDTO,
  ): Promise<AppDTO> {
    const app = await this.manageable(userId, slug);
    const problem = appPermissionsProblem(
      input.permissions ?? app.permissions,
      input.events ?? app.events,
    );
    if (problem) throw new InvalidAppPermissionsError(problem);
    // appPermissionsProblem has checked every key and level.
    const permissions = (input.permissions ??
      app.permissions) as AppPermissions;
    const events = [...new Set(input.events ?? app.events)];
    const changesGrant = input.permissions != null || input.events != null;
    const [{ installations } = { installations: 0 }] = changesGrant
      ? await this.db
          .select({ installations: count() })
          .from(schema.appInstallation)
          .where(eq(schema.appInstallation.appId, app.id))
      : [];
    // Until owners can review new permissions, an installed app may only ask for less.
    const raises =
      Object.entries(permissions).some(
        ([name, level]) =>
          !grants(
            app.permissions as AppPermissions,
            name as AppPermission,
            level,
          ),
      ) || events.some((event) => !app.events.includes(event));
    if (installations > 0 && raises) throw new PermissionRaiseError();

    const [endpoint] = await this.db
      .select({
        id: schema.webhookEndpoint.id,
        url: schema.webhookEndpoint.url,
        secret: schema.webhookEndpoint.secret,
      })
      .from(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.appId, app.id));
    const webhook =
      input.webhookUrl !== undefined || input.webhookSecret !== undefined
        ? await this.webhookOf(
            input.webhookUrl !== undefined
              ? input.webhookUrl
              : (endpoint?.url ?? null),
            input.webhookSecret !== undefined
              ? this.sealed(input.webhookSecret)
              : (endpoint?.secret ?? null),
            input.webhookUrl !== undefined,
          )
        : endpoint && { url: endpoint.url, secret: endpoint.secret };

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.app)
        .set({
          updatedAt: new Date(),
          ...(input.name != null && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.homepageUrl != null && {
            homepageUrl: input.homepageUrl,
          }),
          ...(input.setupUrl !== undefined && { setupUrl: input.setupUrl }),
          ...(changesGrant && { permissions, events }),
        })
        .where(eq(schema.app.id, app.id));
      if (!webhook && endpoint)
        await tx
          .delete(schema.webhookEndpoint)
          .where(eq(schema.webhookEndpoint.id, endpoint.id));
      if (webhook && endpoint)
        await tx
          .update(schema.webhookEndpoint)
          .set({
            ...webhook,
            active: input.webhookActive,
            // turning it back on is the owner saying the problem is fixed
            ...(input.webhookActive === true && {
              disabledReason: null,
              disabledNotifiedAt: null,
            }),
          })
          .where(eq(schema.webhookEndpoint.id, endpoint.id));
      if (webhook && !endpoint)
        await tx
          .insert(schema.webhookEndpoint)
          .values({ appId: app.id, ...webhook, events: [] });
      if (installations > 0)
        await this.lowerInstallations(tx, app.id, permissions, events);
      if (input.name != null)
        await tx
          .update(schema.user)
          .set({ name: input.name })
          .where(eq(schema.user.id, app.botUserId));
    });
    if (webhook && !endpoint) await this.ping(app.id, slug);
    return this.one(app.id);
  }

  async webhookDeliveries(userId: string, slug: string) {
    const { owner, webhookId } = await this.webhookOwner(userId, slug);
    return this.webhooks.deliveries(owner, webhookId);
  }

  async redeliverWebhook(userId: string, slug: string, deliveryId: string) {
    const { owner, webhookId } = await this.webhookOwner(userId, slug);
    await this.webhooks.redeliver(owner, webhookId, deliveryId);
  }

  async pingWebhook(userId: string, slug: string) {
    const { owner, webhookId } = await this.webhookOwner(userId, slug);
    await this.webhooks.ping(owner, webhookId);
  }

  /** The app's endpoint, for its manager; a 404 without a webhook URL. */
  private async webhookOwner(userId: string, slug: string) {
    const { id } = await this.manageable(userId, slug);
    const [endpoint] = await this.db
      .select({ id: schema.webhookEndpoint.id })
      .from(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.appId, id));
    if (!endpoint) throw new AppNotFoundError();
    const owner: WebhookOwner = { appId: id, name: slug };
    return { owner, webhookId: endpoint.id };
  }

  /** What the app's endpoint becomes: null without a URL. A URL needs a secret, and a new URL must reach a public address. */
  private async webhookOf(
    url: string | null,
    secret: string | null,
    checkUrl = true,
  ) {
    if (!url) return null;
    if (!secret) throw new AppWebhookSecretRequiredError();
    if (checkUrl) {
      const problem = await webhookUrlProblem(url, this.allowPrivateWebhooks);
      if (problem) throw new InvalidWebhookUrlError(problem);
    }
    return { url, secret };
  }

  private async ping(appId: string, slug: string) {
    const [endpoint] = await this.db
      .select({
        id: schema.webhookEndpoint.id,
        url: schema.webhookEndpoint.url,
        events: schema.webhookEndpoint.events,
      })
      .from(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.appId, appId));
    if (endpoint) await this.fanout.ping(endpoint, { appId, name: slug });
  }

  /** Applies a lowered set to every installation of the app, and revokes the tokens that hold more than it now allows. */
  private async lowerInstallations(
    tx: Executor,
    appId: string,
    permissions: AppPermissions,
    events: string[],
  ) {
    const accepted = withMetadata(permissions);
    const installations = await tx
      .update(schema.appInstallation)
      .set({ permissions: accepted, events })
      .where(eq(schema.appInstallation.appId, appId))
      .returning({ id: schema.appInstallation.id });
    const tokens = await tx
      .select({
        id: schema.appInstallationToken.id,
        permissions: schema.appInstallationToken.permissions,
      })
      .from(schema.appInstallationToken)
      .where(
        inArray(
          schema.appInstallationToken.installationId,
          installations.map(({ id }) => id),
        ),
      );
    const exceeding = tokens
      .filter((token) =>
        Object.entries(token.permissions).some(
          ([name, level]) => !grants(accepted, name as AppPermission, level),
        ),
      )
      .map(({ id }) => id);
    if (exceeding.length > 0)
      await tx
        .delete(schema.appInstallationToken)
        .where(inArray(schema.appInstallationToken.id, exceeding));
  }

  async remove(userId: string, slug: string): Promise<void> {
    const { id } = await this.manageable(userId, slug);
    await this.db.transaction((tx) => deleteApps(tx, eq(schema.app.id, id)));
  }

  /** Only the public half is kept; the private key leaves in this response and nowhere else. */
  async createPrivateKey(
    userId: string,
    slug: string,
  ): Promise<CreatedPrivateKeyDTO> {
    const { id } = await this.manageable(userId, slug);
    const [held] = await this.db
      .select({ keys: count() })
      .from(schema.appPublicKey)
      .where(eq(schema.appPublicKey.appId, id));
    if (held!.keys >= MAX_PRIVATE_KEYS) throw new TooManyPrivateKeysError();

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const fingerprint = `SHA256:${createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('base64')}`;
    const [key] = await this.db
      .insert(schema.appPublicKey)
      .values({
        appId: id,
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string,
        fingerprint,
      })
      .returning({
        id: schema.appPublicKey.id,
        fingerprint: schema.appPublicKey.fingerprint,
        createdAt: isoTimestamp(schema.appPublicKey.createdAt),
      });
    return {
      ...key!,
      // PKCS#1, what GitHub hands out; Octokit reads it and PKCS#8 alike.
      privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }) as string,
    };
  }

  async removePrivateKey(
    userId: string,
    slug: string,
    keyId: string,
  ): Promise<void> {
    const { id } = await this.manageable(userId, slug);
    const removed = await this.db
      .delete(schema.appPublicKey)
      .where(
        and(
          eq(schema.appPublicKey.id, keyId),
          eq(schema.appPublicKey.appId, id),
        ),
      )
      .returning({ id: schema.appPublicKey.id });
    if (removed.length === 0) throw new PrivateKeyNotFoundError();
  }

  /** The bot wears the logo as its avatar, so its comments and statuses show it. */
  async setLogo(
    userId: string,
    slug: string,
    contentType: string,
    body: Buffer | undefined,
  ) {
    const { id, botUserId } = await this.manageable(userId, slug);
    const { url } = await this.avatars.store({
      ownerId: id,
      contentType,
      body,
    });
    await this.setLogoUrl(id, botUserId, url);
    return { url };
  }

  async removeLogo(userId: string, slug: string): Promise<void> {
    const { id, botUserId } = await this.manageable(userId, slug);
    await this.setLogoUrl(id, botUserId, null);
    await this.avatars.remove(id);
  }

  private async setLogoUrl(id: string, botUserId: string, url: string | null) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.app)
        .set({ logoUrl: url })
        .where(eq(schema.app.id, id));
      await tx
        .update(schema.user)
        .set({ image: url })
        .where(eq(schema.user.id, botUserId));
    });
  }

  /** A live app the user owns, or one of an organization they administer. Someone else's personal app is a 404, as GitHub hides it. */
  private async manageable(userId: string, slug: string) {
    const [app] = await this.db
      .select({
        id: schema.app.id,
        botUserId: schema.app.botUserId,
        ownerUserId: schema.app.ownerUserId,
        organization: schema.organization.slug,
        permissions: schema.app.permissions,
        events: schema.app.events,
      })
      .from(schema.app)
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.app.ownerOrganizationId),
      )
      .where(and(eq(schema.app.slug, slug), isNull(schema.app.deletedAt)));
    if (!app) throw new AppNotFoundError();
    if (app.organization)
      await administeredOrganization(this.db, app.organization, userId);
    else if (app.ownerUserId !== userId) throw new AppNotFoundError();
    return app;
  }

  private sealed(secret: string | null | undefined) {
    if (!secret) return null;
    if (!this.webhookKey) throw new WebhooksNotConfiguredError();
    return sealWebhookSecret(this.webhookKey, secret);
  }

  private async one(id: string): Promise<AppDTO> {
    const [app] = await this.select(eq(schema.app.id, id));
    if (!app) throw new AppNotFoundError();
    return app;
  }

  /** Live apps matching `where`, oldest first, as their owners see them. */
  private select(where: SQL): Promise<AppDTO[]> {
    return this.db
      .select({
        ...this.publicColumns(),
        id: schema.app.id,
        botLogin: sql<string>`${schema.app.slug} || '[bot]'`,
        setupUrl: schema.app.setupUrl,
        webhookUrl: schema.webhookEndpoint.url,
        webhookSecretSet: sql<boolean>`${schema.webhookEndpoint.id} is not null`,
        webhookId: schema.webhookEndpoint.id,
        webhookActive: sql<boolean>`coalesce(${schema.webhookEndpoint.active}, false)`,
        webhookDisabledReason: schema.webhookEndpoint.disabledReason,
        installationsCount: sql<number>`(select count(*)::int from ${schema.appInstallation} where ${schema.appInstallation.appId} = ${schema.app.id})`,
        privateKeys: sql<
          AppPrivateKeyDTO[]
        >`coalesce((select json_agg(json_build_object('id', ${schema.appPublicKey.id}, 'fingerprint', ${schema.appPublicKey.fingerprint}, 'createdAt', ${isoTimestamp(schema.appPublicKey.createdAt)}) order by ${schema.appPublicKey.createdAt}) from ${schema.appPublicKey} where ${schema.appPublicKey.appId} = ${schema.app.id}), '[]'::json)`,
        createdAt: isoTimestamp(schema.app.createdAt),
      })
      .from(schema.app)
      .leftJoin(
        schema.webhookEndpoint,
        eq(schema.webhookEndpoint.appId, schema.app.id),
      )
      .leftJoin(schema.user, eq(schema.user.id, schema.app.ownerUserId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.app.ownerOrganizationId),
      )
      .where(and(where, isNull(schema.app.deletedAt)))
      .orderBy(asc(schema.app.createdAt));
  }

  /** Needs `user` joined on the owning user and `organization` on the owning organization. */
  private publicColumns() {
    return {
      appId: schema.app.numericId,
      slug: schema.app.slug,
      name: schema.app.name,
      description: schema.app.description,
      homepageUrl: schema.app.homepageUrl,
      logoUrl: schema.app.logoUrl,
      owner: sql<AppOwnerDTO>`json_build_object('login', coalesce(${schema.organization.slug}, ${schema.user.username}), 'type', case when ${schema.app.ownerOrganizationId} is null then 'user' else 'organization' end)`,
      installUrl: sql<string>`${`${this.web}/apps/`} || ${schema.app.slug} || '/installations/new'`,
      permissions: sql<
        AppDTO['permissions']
      >`jsonb_build_object('metadata', 'read') || ${schema.app.permissions}`,
      events: schema.app.events,
    };
  }
}
