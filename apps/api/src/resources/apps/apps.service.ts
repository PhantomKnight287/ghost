import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import { type Database, schema } from '@ghost/db';
import type { AppPermissions } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, eq, isNull, type SQL, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  AppNameTakenError,
  AppNameUnusableError,
  AppNotFoundError,
  InvalidAppPermissionsError,
  PrivateKeyNotFoundError,
  TooManyPrivateKeysError,
} from '../../lib/apps/apps.errors.js';
import { deleteApps } from '../../lib/apps/delete-apps.js';
import { appPermissionsProblem } from '../../lib/apps/permissions.js';
import { appSlug } from '../../lib/apps/slug.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import { githubOrigins } from '../../lib/github/origins.js';
import { administeredOrganization } from '../../lib/organizations/administered-organization.js';
import { WebhooksNotConfiguredError } from '../../lib/webhooks/webhooks.errors.js';
import {
  sealWebhookSecret,
  webhookSecretKey,
} from '../../lib/webhooks/webhooks.js';
import { AvatarStorageService } from '../../services/avatars/avatar-storage.service.js';
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

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly avatars: AvatarStorageService,
    config: ConfigService,
  ) {
    this.web = githubOrigins(config).web;
    this.webhookKey = webhookSecretKey(
      config.get<string>('WEBHOOK_SECRET_KEY'),
    );
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
    const webhookSecret = this.sealed(input.webhookSecret);

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
            webhookUrl: input.webhookUrl ?? null,
            webhookSecret,
            // appPermissionsProblem has checked every key and level.
            permissions: input.permissions as AppPermissions,
            events: [...new Set(input.events)],
            ownerUserId: organizationId ? null : userId,
            ownerOrganizationId: organizationId,
            botUserId,
          })
          .returning({ id: schema.app.id });
        return app!.id;
      })
      .catch((error: unknown) => {
        // The slug, the bot's username and its email are all made from the name, so any of them taken means the name is; deleted apps keep theirs.
        if ((error as { cause?: { code?: string } }).cause?.code === '23505')
          throw new AppNameTakenError();
        throw error;
      });
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
    // ponytail: raising permissions or adding events is allowed until installations exist; slice 2 refuses it while the app has any.

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.app)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.homepageUrl !== undefined && {
            homepageUrl: input.homepageUrl,
          }),
          ...(input.setupUrl !== undefined && { setupUrl: input.setupUrl }),
          ...(input.webhookUrl !== undefined && {
            webhookUrl: input.webhookUrl,
          }),
          ...(input.webhookSecret !== undefined && {
            webhookSecret: this.sealed(input.webhookSecret),
          }),
          ...(input.permissions !== undefined && {
            // appPermissionsProblem has checked every key and level.
            permissions: input.permissions as AppPermissions,
          }),
          ...(input.events !== undefined && {
            events: [...new Set(input.events)],
          }),
        })
        .where(eq(schema.app.id, app.id));
      if (input.name !== undefined)
        await tx
          .update(schema.user)
          .set({ name: input.name })
          .where(eq(schema.user.id, app.botUserId));
    });
    return this.one(app.id);
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
        webhookUrl: schema.app.webhookUrl,
        webhookSecretSet: sql<boolean>`${schema.app.webhookSecret} is not null`,
        permissions: sql<
          AppDTO['permissions']
        >`jsonb_build_object('metadata', 'read') || ${schema.app.permissions}`,
        events: schema.app.events,
        privateKeys: sql<
          AppPrivateKeyDTO[]
        >`coalesce((select json_agg(json_build_object('id', ${schema.appPublicKey.id}, 'fingerprint', ${schema.appPublicKey.fingerprint}, 'createdAt', ${isoTimestamp(schema.appPublicKey.createdAt)}) order by ${schema.appPublicKey.createdAt}) from ${schema.appPublicKey} where ${schema.appPublicKey.appId} = ${schema.app.id}), '[]'::json)`,
        createdAt: isoTimestamp(schema.app.createdAt),
      })
      .from(schema.app)
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
    };
  }
}
