import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

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
  const [row] = await db
    .select({
      clientId: schema.oauthClient.clientId,
      name: schema.oauthClient.name,
      redirectUris: schema.oauthClient.redirectUris,
      disabled: schema.oauthClient.disabled,
      metadata: schema.oauthClient.metadata,
      ownerId: schema.oauthClient.userId,
    })
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.clientId, clientId));
  if (!row || row.disabled) return null;
  return {
    clientId: row.clientId,
    name: row.name ?? row.clientId,
    redirectUris: row.redirectUris,
    deviceFlowEnabled:
      (row.metadata as { deviceFlow?: boolean } | null)?.deviceFlow === true,
    builtIn: row.ownerId === null,
    ownerId: row.ownerId,
  };
}
