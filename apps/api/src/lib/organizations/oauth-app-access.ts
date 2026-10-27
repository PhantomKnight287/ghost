import { type Database, schema } from '@ghost/db';
import { eq, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { OauthAppRestrictedError } from './organization.errors.js';
import { sameName } from '../db/sql.js';

/** Whether the organization's OAuth app restrictions keep the app out of its repositories: they are on, and the app is neither built into the instance, nor the organization's own, nor approved by it. A null `clientId` is an app that cannot be identified, which restrictions always keep out. `organizationId` may be a column, to ask about every row of a query. */
export function oauthAppBlockedIn(
  organizationId: AnyPgColumn | string,
  clientId: string | null,
) {
  return sql<boolean>`exists (select 1 from ${schema.organizationSettings} where ${schema.organizationSettings.organizationId} = ${organizationId} and ${schema.organizationSettings.oauthAppRestrictions} and not exists (select 1 from ${schema.oauthClient} where ${schema.oauthClient.clientId} = ${clientId} and ((${schema.oauthClient.userId} is null and ${schema.oauthClient.referenceId} is null) or ${schema.oauthClient.referenceId} = ${organizationId})) and not exists (select 1 from ${schema.organizationOauthApp} where ${schema.organizationOauthApp.organizationId} = ${organizationId} and ${schema.organizationOauthApp.clientId} = ${clientId} and ${schema.organizationOauthApp.state} = 'approved'))`;
}

export async function oauthAppBlocked(
  db: Pick<Database, 'select'>,
  {
    clientId,
    organizationId,
  }: { clientId: string | null; organizationId: string },
) {
  const [organization] = await db
    .select({ blocked: oauthAppBlockedIn(organizationId, clientId) })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId));
  return organization?.blocked ?? false;
}

/** Refuses a write into the organization behind `slug`, such as creating a repository there, by an OAuth app its restrictions keep out. */
export async function requireOauthAppAllowed(
  db: Pick<Database, 'select'>,
  clientId: string,
  slug: string,
) {
  const [organization] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(sameName(schema.organization.slug, slug));
  if (
    organization &&
    (await oauthAppBlocked(db, { clientId, organizationId: organization.id }))
  )
    throw new OauthAppRestrictedError(slug);
}
