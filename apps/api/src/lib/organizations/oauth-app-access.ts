import { type Database, schema } from '@ghost/db';
import { and, eq, sql } from 'drizzle-orm';

import { OauthAppRestrictedError } from './organization.errors.js';

/** Whether the organization's OAuth app restrictions keep the app out of its repositories: they are on, and the app is neither built into the instance, nor the organization's own, nor approved by it. A null `clientId` is an app that cannot be identified, which restrictions always keep out. */
export async function oauthAppBlocked(
  db: Pick<Database, 'select'>,
  {
    clientId,
    organizationId,
  }: { clientId: string | null; organizationId: string },
) {
  const [settings] = await db
    .select({
      blocked: sql<boolean>`not exists (select 1 from ${schema.oauthClient} where ${schema.oauthClient.clientId} = ${clientId} and ((${schema.oauthClient.userId} is null and ${schema.oauthClient.referenceId} is null) or ${schema.oauthClient.referenceId} = ${organizationId})) and not exists (select 1 from ${schema.organizationOauthApp} where ${schema.organizationOauthApp.organizationId} = ${organizationId} and ${schema.organizationOauthApp.clientId} = ${clientId} and ${schema.organizationOauthApp.state} = 'approved')`,
    })
    .from(schema.organizationSettings)
    .where(
      and(
        eq(schema.organizationSettings.organizationId, organizationId),
        eq(schema.organizationSettings.oauthAppRestrictions, true),
      ),
    );
  return settings?.blocked ?? false;
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
    .where(eq(schema.organization.slug, slug));
  if (
    organization &&
    (await oauthAppBlocked(db, { clientId, organizationId: organization.id }))
  )
    throw new OauthAppRestrictedError(slug);
}
