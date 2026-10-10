import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { AvatarStorageService } from '../../services/avatars/avatar-storage.service.js';
import type { Auth } from '../../lib/auth.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import {
  findOauthApp,
  keyOauthClientId,
  oauthAppColumns,
  oauthAppEnabled,
} from '../../lib/github/oauth-apps.js';
import {
  AuthorizedOauthAppNotFoundError,
  BuiltInOauthAppError,
  OauthAppNotFoundError,
} from '../../lib/oauth-apps/oauth-apps.errors.js';
import type {
  AuthorizingOauthAppDTO,
  ListAuthorizedOauthAppsResponseDTO,
  CreatedOauthAppDTO,
  CreateOauthAppDTO,
  ListOauthAppsResponseDTO,
  OauthAppDTO,
  OauthAppSecretDTO,
  UpdateOauthAppDTO,
} from './dto/oauth-app.dto.js';

const homepageUrl = sql<string>`coalesce(${schema.oauthClient.uri}, '')`;

/** The plugin checks every redirect URI against one application type: a web client may not use http on localhost, a native one may use both shapes the DTO admits, so one app can list a production callback and a local one. */
const APPLICATION_TYPE = 'native';

/** OAuth apps a user registers, kept in the oauth-provider plugin's registry. Writes go through the plugin so secrets are hashed its way; Ghost adds GitHub's rules on top. */
@Injectable()
export class OauthAppsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly auth: AuthService<Auth>,
    private readonly avatars: AvatarStorageService,
  ) {}

  async list(userId: string): Promise<ListOauthAppsResponseDTO> {
    const apps = await this.select()
      .where(eq(schema.oauthClient.userId, userId))
      .orderBy(schema.oauthClient.createdAt);
    return { apps };
  }

  async get(userId: string, clientId: string): Promise<OauthAppDTO> {
    const [app] = await this.select().where(
      and(
        eq(schema.oauthClient.clientId, clientId),
        eq(schema.oauthClient.userId, userId),
      ),
    );
    if (!app) throw new OauthAppNotFoundError();
    return app;
  }

  /** What a consent or device-approval page shows about any enabled app, whoever owns it. */
  async describe(clientId: string): Promise<AuthorizingOauthAppDTO> {
    const [app] = await this.db
      .select({
        clientId: oauthAppColumns.clientId,
        name: oauthAppColumns.name,
        description: oauthAppColumns.description,
        homepageUrl,
        logoUrl: oauthAppColumns.logoUrl,
        owner: schema.user.username,
      })
      .from(schema.oauthClient)
      .leftJoin(schema.user, eq(schema.user.id, schema.oauthClient.userId))
      .where(and(eq(schema.oauthClient.clientId, clientId), oauthAppEnabled));
    if (!app) throw new OauthAppNotFoundError();
    return app;
  }

  async create(
    headers: Headers,
    userId: string,
    input: CreateOauthAppDTO,
  ): Promise<CreatedOauthAppDTO> {
    const created = await this.auth.api.adminCreateOAuthClient({
      headers,
      body: {
        client_name: input.name,
        client_uri: input.homepageUrl,
        redirect_uris: input.callbackUrls,
        application_type: APPLICATION_TYPE,
        // GitHub's web flow posts the secret in the form body and makes PKCE optional.
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        require_pkce: false,
      },
    });
    await this.setGhostFields(created.client_id, {
      deviceFlow: input.deviceFlowEnabled ?? false,
      description: input.description,
    });
    return {
      ...(await this.get(userId, created.client_id)),
      clientSecret: created.client_secret as string,
    };
  }

  async update(
    headers: Headers,
    userId: string,
    clientId: string,
    input: UpdateOauthAppDTO,
  ): Promise<OauthAppDTO> {
    await this.editable(userId, clientId);
    await this.auth.api.adminUpdateOAuthClient({
      headers,
      body: {
        client_id: clientId,
        // The plugin merges `update` over the stored client, so an absent field must be left out rather than sent as undefined.
        update: {
          ...(input.name !== undefined && { client_name: input.name }),
          ...(input.homepageUrl !== undefined && {
            client_uri: input.homepageUrl,
          }),
          ...(input.callbackUrls !== undefined && {
            redirect_uris: input.callbackUrls,
            application_type: APPLICATION_TYPE,
          }),
        },
      },
    });
    await this.setGhostFields(clientId, {
      deviceFlow: input.deviceFlowEnabled,
      description: input.description,
    });
    return this.get(userId, clientId);
  }

  async rotateSecret(
    headers: Headers,
    userId: string,
    clientId: string,
  ): Promise<OauthAppSecretDTO> {
    await this.editable(userId, clientId);
    const rotated = await this.auth.api.rotateClientSecret({
      headers,
      body: { client_id: clientId },
    });
    return { clientSecret: rotated.client_secret as string };
  }

  /** Deletes the app and the keys it minted for every user, as GitHub revokes every token of a deleted app. */
  async remove(
    headers: Headers,
    userId: string,
    clientId: string,
  ): Promise<void> {
    await this.editable(userId, clientId);
    await this.db.delete(schema.apikey).where(eq(keyOauthClientId, clientId));
    await this.auth.api.deleteOAuthClient({
      headers,
      body: { client_id: clientId },
    });
    await this.avatars.remove(clientId);
  }

  async setLogo(
    userId: string,
    clientId: string,
    contentType: string,
    body: Buffer | undefined,
  ) {
    await this.editable(userId, clientId);
    const { url } = await this.avatars.store({
      ownerId: clientId,
      contentType,
      body,
    });
    await this.db
      .update(schema.oauthClient)
      .set({ icon: url })
      .where(eq(schema.oauthClient.clientId, clientId));
    return { url };
  }

  async removeLogo(userId: string, clientId: string): Promise<void> {
    await this.editable(userId, clientId);
    await this.db
      .update(schema.oauthClient)
      .set({ icon: null })
      .where(eq(schema.oauthClient.clientId, clientId));
    await this.avatars.remove(clientId);
  }

  /** Apps holding a key for this user, gh included. */
  async listAuthorized(
    userId: string,
  ): Promise<ListAuthorizedOauthAppsResponseDTO> {
    const apps = await this.db
      .select({
        clientId: oauthAppColumns.clientId,
        name: oauthAppColumns.name,
        logoUrl: oauthAppColumns.logoUrl,
        // jsonb_agg runs over the outer group; Postgres allows that only in a select list, hence the one-row derived table.
        scopes: sql<
          string[]
        >`array(select distinct scope from (select jsonb_agg(coalesce(${schema.apikey.permissions}::jsonb->'scopes', '[]')) as granted) as keys, jsonb_array_elements(keys.granted) as key_scopes, jsonb_array_elements_text(key_scopes) as scope order by scope)`,
        authorizedAt: isoTimestamp(sql`min(${schema.apikey.createdAt})`),
        lastUsedAt: sql<
          string | null
        >`${isoTimestamp(sql`max(${schema.apikey.lastRequest})`)}`,
      })
      .from(schema.apikey)
      .innerJoin(
        schema.oauthClient,
        eq(schema.oauthClient.clientId, keyOauthClientId),
      )
      .where(eq(schema.apikey.referenceId, userId))
      .groupBy(schema.oauthClient.id)
      .orderBy(oauthAppColumns.name);
    return { apps };
  }

  /** Deletes this user's keys for the app and their consent, so the app asks again next time. Other users' keys stay. */
  async revokeAuthorized(userId: string, clientId: string): Promise<void> {
    const keys = await this.db
      .delete(schema.apikey)
      .where(
        and(
          eq(schema.apikey.referenceId, userId),
          eq(keyOauthClientId, clientId),
        ),
      )
      .returning({ id: schema.apikey.id });
    if (keys.length === 0) throw new AuthorizedOauthAppNotFoundError();
    await this.db
      .delete(schema.oauthConsent)
      .where(
        and(
          eq(schema.oauthConsent.userId, userId),
          eq(schema.oauthConsent.clientId, clientId),
        ),
      );
  }

  private select() {
    return this.db
      .select({
        ...oauthAppColumns,
        homepageUrl,
        callbackUrls: schema.oauthClient.redirectUris,
        createdAt: isoTimestamp(schema.oauthClient.createdAt),
      })
      .from(schema.oauthClient);
  }

  /** The plugin's update drops `metadata`, where Ghost keeps the fields the plugin lacks, so they are merged in here. An undefined field is left as it is. */
  private async setGhostFields(
    clientId: string,
    fields: { deviceFlow?: boolean; description?: string },
  ) {
    await this.db
      .update(schema.oauthClient)
      .set({
        metadata: sql`coalesce(${schema.oauthClient.metadata}, '{}'::jsonb) || ${JSON.stringify(fields)}::jsonb`,
      })
      .where(eq(schema.oauthClient.clientId, clientId));
  }

  private async editable(userId: string, clientId: string) {
    const app = await findOauthApp(this.db, clientId);
    if (app?.builtIn) throw new BuiltInOauthAppError();
    if (app?.ownerId !== userId) throw new OauthAppNotFoundError();
  }
}
