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
};

/** An enabled OAuth app from the oauth-provider plugin's registry, or null. */
export async function findOauthApp(
  db: Database,
  clientId: string,
): Promise<OauthApp | null> {
  const [app] = await db
    .select({
      clientId: schema.oauthClient.clientId,
      name: sql<string>`coalesce(${schema.oauthClient.name}, ${schema.oauthClient.clientId})`,
      redirectUris: schema.oauthClient.redirectUris,
      deviceFlowEnabled: sql<boolean>`coalesce((${schema.oauthClient.metadata}->>'deviceFlow')::boolean, false)`,
      builtIn: sql<boolean>`${schema.oauthClient.userId} is null`,
      ownerId: schema.oauthClient.userId,
    })
    .from(schema.oauthClient)
    .where(
      and(
        eq(schema.oauthClient.clientId, clientId),
        sql`${schema.oauthClient.disabled} is not true`,
      ),
    );
  return app ?? null;
}
