import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  ClientSecretNotFoundError,
  TooManyClientSecretsError,
} from '../../lib/apps/apps.errors.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import { setOauthClientFields } from '../../lib/github/oauth-apps.js';

const MAX_CLIENT_SECRETS = 20;

const hashSecret = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');

/** What an app's OAuth client is made from. */
export type AppClientFields = {
  name: string;
  homepageUrl: string;
  callbackUrls: string[];
  expireUserTokens: boolean;
  deviceFlowEnabled: boolean;
};

/** A Ghost App's OAuth client, so its website can sign users in through `/login/oauth/*`. Ghost checks the app's own secrets, of which it may hold several, and speaks to the plugin with `pluginSecretOf`. */
@Injectable()
export class AppClientsService {
  private readonly authSecret: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService,
  ) {
    this.authSecret = config.getOrThrow<string>('BETTER_AUTH_SECRET');
  }

  /** The one secret the plugin knows the app's client by, derived rather than stored. Ghost checks the app's own secrets, then passes this one on: the plugin refuses a public client without PKCE, and GitHub's web flow sends none (user decision, 2026-10-30). Rotating BETTER_AUTH_SECRET means rewriting the stored hashes. */
  pluginSecretOf(clientId: string) {
    return createHmac('sha256', this.authSecret)
      .update(`ghost-app-client:${clientId}`)
      .digest('hex');
  }

  /** The app's client id, creating its client on first need: apps registered before slice 5 have none. */
  async clientOf(appId: string): Promise<string> {
    const [app] = await this.db
      .select({
        clientId: schema.app.oauthClientId,
        name: schema.app.name,
        homepageUrl: schema.app.homepageUrl,
      })
      .from(schema.app)
      .where(eq(schema.app.id, appId));
    if (!app) throw new Error(`No app ${appId}`);
    if (app.clientId) return app.clientId;
    // Written here, not through the plugin's create, which refuses a client with no callback URL; a new app has none yet (user decision, 2026-10-30).
    const clientId = `Iv1.${randomBytes(8).toString('hex')}`;
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.oauthClient).values({
        id: randomUUID(),
        clientId,
        name: app.name,
        uri: app.homepageUrl,
        redirectUris: [],
        applicationType: 'native',
        tokenEndpointAuthMethod: 'client_secret_post',
        // Stored the way the plugin stores secrets: base64url of the sha256, unpadded.
        clientSecret: createHash('sha256')
          .update(this.pluginSecretOf(clientId))
          .digest('base64url'),
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        requirePKCE: false,
        disabled: false,
        metadata: { appId, expireUserTokens: true, deviceFlow: false },
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .update(schema.app)
        .set({ oauthClientId: clientId })
        .where(eq(schema.app.id, appId));
    });
    return clientId;
  }

  /** Brings the client in line with the app. An undefined field is left as it is. Written directly, as `clientOf` writes it: the plugin's update refuses an empty callback list. */
  async sync(appId: string, fields: Partial<AppClientFields>) {
    const clientId = await this.clientOf(appId);
    await this.db
      .update(schema.oauthClient)
      .set({
        updatedAt: new Date(),
        ...(fields.name !== undefined && { name: fields.name }),
        ...(fields.homepageUrl !== undefined && { uri: fields.homepageUrl }),
        ...(fields.callbackUrls !== undefined && {
          redirectUris: fields.callbackUrls,
        }),
      })
      .where(eq(schema.oauthClient.clientId, clientId));
    await setOauthClientFields(this.db, clientId, {
      expireUserTokens: fields.expireUserTokens,
      deviceFlow: fields.deviceFlowEnabled,
    });
  }

  /** The app whose client this is, when `secret` is one of its live secrets. */
  async authenticate(
    clientId: string,
    secret: string,
  ): Promise<{ appId: string } | null> {
    const [match] = await this.db
      .select({ appId: schema.app.id })
      .from(schema.appClientSecret)
      .innerJoin(schema.app, eq(schema.app.id, schema.appClientSecret.appId))
      .where(
        and(
          eq(schema.app.oauthClientId, clientId),
          eq(schema.appClientSecret.secretHash, hashSecret(secret)),
          isNull(schema.app.deletedAt),
        ),
      );
    return match ?? null;
  }

  async secretsOf(appId: string) {
    return this.db
      .select({
        id: schema.appClientSecret.id,
        lastEight: schema.appClientSecret.lastEight,
        createdAt: isoTimestamp(schema.appClientSecret.createdAt),
      })
      .from(schema.appClientSecret)
      .where(eq(schema.appClientSecret.appId, appId))
      .orderBy(asc(schema.appClientSecret.createdAt));
  }

  /** The secret leaves in this response and nowhere else. */
  async createSecret(appId: string) {
    const [held] = await this.db
      .select({ secrets: count() })
      .from(schema.appClientSecret)
      .where(eq(schema.appClientSecret.appId, appId));
    if (held!.secrets >= MAX_CLIENT_SECRETS)
      throw new TooManyClientSecretsError();
    await this.clientOf(appId);
    const clientSecret = `ghost_cs_${randomBytes(20).toString('hex')}`;
    const [created] = await this.db
      .insert(schema.appClientSecret)
      .values({
        appId,
        secretHash: hashSecret(clientSecret),
        lastEight: clientSecret.slice(-8),
      })
      .returning({
        id: schema.appClientSecret.id,
        lastEight: schema.appClientSecret.lastEight,
        createdAt: isoTimestamp(schema.appClientSecret.createdAt),
      });
    return { ...created!, clientSecret };
  }

  async removeSecret(appId: string, id: string) {
    const removed = await this.db
      .delete(schema.appClientSecret)
      .where(
        and(
          eq(schema.appClientSecret.id, id),
          eq(schema.appClientSecret.appId, appId),
        ),
      )
      .returning({ id: schema.appClientSecret.id });
    if (removed.length === 0) throw new ClientSecretNotFoundError();
  }
}
