import { AsyncLocalStorage } from 'node:async_hooks';

import { type Database, schema } from '@ghost/db';
import { and, eq, sql } from 'drizzle-orm';

import type { Executor } from '../db/executor.js';

export type OauthApp = {
  clientId: string;
  name: string;
  redirectUris: string[];
  deviceFlowEnabled: boolean;
  /** GitHub's "Expire user authorization tokens": keys last 8 hours and come with a refresh token. */
  expireUserTokens: boolean;
  /** Built into the instance, such as gh: no owner, and no one can edit or delete it. */
  builtIn: boolean;
  ownerId: string | null;
  /** Slug of the organization that owns the app, null for a user's app. */
  organization: string | null;
  /** Set when the client is a Ghost App's: its tokens are `ghu_`, and its secrets are the app's. */
  ghostAppId: string | null;
};

/** The organization a call into the oauth-provider plugin acts for. The plugin's `clientReference` reads it, so an org's app is created with it as `referenceId` and only calls made for that org may change it. Outside a call it is unset, and apps belong to users. */
export const oauthAppOrganization = new AsyncLocalStorage<string>();

/** Columns of an OAuth app as Ghost names them, shared by every query that reads one. */
export const oauthAppColumns = {
  clientId: schema.oauthClient.clientId,
  name: sql<string>`coalesce(${schema.oauthClient.name}, ${schema.oauthClient.clientId})`,
  description: sql<
    string | null
  >`${schema.oauthClient.metadata}->>'description'`,
  logoUrl: schema.oauthClient.icon,
  homepageUrl: sql<string>`coalesce(${schema.oauthClient.uri}, '')`,
  deviceFlowEnabled: sql<boolean>`coalesce((${schema.oauthClient.metadata}->>'deviceFlow')::boolean, false)`,
  expireUserTokens: sql<boolean>`coalesce((${schema.oauthClient.metadata}->>'expireUserTokens')::boolean, false)`,
};

/** Vouched for by the instance. Only an operator sets it, in the database or the seed; no API writes it. */
export const oauthAppVerified = sql<boolean>`coalesce((${schema.oauthClient.metadata}->>'verified')::boolean, false)`;

/** The OAuth app an API key was minted for, null for keys made in Ghost. */
export const keyOauthClientId = sql<
  string | null
>`${schema.apikey.metadata}::jsonb->>'oauthClientId'`;

/** The plugin leaves `disabled` null on apps it never touched. */
export const oauthAppEnabled = sql`${schema.oauthClient.disabled} is not true`;

/** An enabled OAuth app from the oauth-provider plugin's registry, or null. */
export async function findOauthApp(
  db: Database,
  clientId: string,
): Promise<OauthApp | null> {
  const [app] = await db
    .select({
      clientId: oauthAppColumns.clientId,
      name: oauthAppColumns.name,
      deviceFlowEnabled: oauthAppColumns.deviceFlowEnabled,
      expireUserTokens: oauthAppColumns.expireUserTokens,
      redirectUris: schema.oauthClient.redirectUris,
      builtIn: sql<boolean>`${schema.oauthClient.userId} is null and ${schema.oauthClient.referenceId} is null`,
      ownerId: schema.oauthClient.userId,
      organization: schema.organization.slug,
      ghostAppId: sql<string | null>`${schema.oauthClient.metadata}->>'appId'`,
    })
    .from(schema.oauthClient)
    .leftJoin(
      schema.organization,
      eq(schema.organization.id, schema.oauthClient.referenceId),
    )
    .where(and(eq(schema.oauthClient.clientId, clientId), oauthAppEnabled));
  return app ?? null;
}

/** The plugin's update drops `metadata`, where Ghost keeps the fields the plugin lacks, so they are merged in here. An undefined field is left as it is. */
export async function setOauthClientFields(
  db: Executor,
  clientId: string,
  fields: {
    deviceFlow?: boolean;
    expireUserTokens?: boolean;
    description?: string;
    appId?: string;
  },
) {
  await db
    .update(schema.oauthClient)
    .set({
      metadata: sql`coalesce(${schema.oauthClient.metadata}, '{}'::jsonb) || ${JSON.stringify(fields)}::jsonb`,
    })
    .where(eq(schema.oauthClient.clientId, clientId));
}
