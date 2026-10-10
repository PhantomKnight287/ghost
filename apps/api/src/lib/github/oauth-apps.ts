import { AsyncLocalStorage } from 'node:async_hooks';

import { type Database, schema } from '@ghost/db';
import { and, eq, sql } from 'drizzle-orm';

export type OauthApp = {
  clientId: string;
  name: string;
  redirectUris: string[];
  deviceFlowEnabled: boolean;
  /** Built into the instance, such as gh: no owner, and no one can edit or delete it. */
  builtIn: boolean;
  ownerId: string | null;
  /** Slug of the organization that owns the app, null for a user's app. */
  organization: string | null;
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
  deviceFlowEnabled: sql<boolean>`coalesce((${schema.oauthClient.metadata}->>'deviceFlow')::boolean, false)`,
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
      redirectUris: schema.oauthClient.redirectUris,
      builtIn: sql<boolean>`${schema.oauthClient.userId} is null and ${schema.oauthClient.referenceId} is null`,
      ownerId: schema.oauthClient.userId,
      organization: schema.organization.slug,
    })
    .from(schema.oauthClient)
    .leftJoin(
      schema.organization,
      eq(schema.organization.id, schema.oauthClient.referenceId),
    )
    .where(and(eq(schema.oauthClient.clientId, clientId), oauthAppEnabled));
  return app ?? null;
}
