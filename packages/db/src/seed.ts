import { sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { oauthClient } from "./schema/oauth.js";

/** gh's OAuth app: the same client id on every GitHub host, so Ghost registers it under that id. No owner, so nobody can edit or delete it; no secret, as gh uses the device flow. */
export const GITHUB_CLI_CLIENT_ID = "178c6fc778ccc68e1d6a";

/** Rows every instance needs and no migration should carry. Safe to rerun: an existing row keeps its fields, and only gains the verified mark. */
export async function seedBuiltInRows(db: Database) {
  await db
    .insert(oauthClient)
    .values({
      id: "github-cli",
      clientId: GITHUB_CLI_CLIENT_ID,
      name: "GitHub CLI",
      uri: "https://cli.github.com",
      redirectUris: [],
      tokenEndpointAuthMethod: "none",
      skipConsent: false,
      metadata: { deviceFlow: true, verified: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: oauthClient.clientId,
      set: {
        metadata: sql`coalesce(${oauthClient.metadata}, '{}'::jsonb) || '{"verified":true}'::jsonb`,
      },
    });
}
