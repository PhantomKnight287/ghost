import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Config } from "./config.ts";
import * as schema from "./db/schema.ts";
import type { Side } from "./side.ts";

type Database = PostgresJsDatabase<typeof schema>;
type GhostUser = { id: number | string; login: string; name: string | null; email: string | null; avatar_url: string | null };

/**
 * Sign in with Ghost; GitHub can only be linked to a Ghost user, never used to create one. OAuth tokens are stored encrypted, and nothing else signs in: no passwords.
 */
export function createAuth(db: Database, config: Config) {
  return betterAuth({
    secret: config.SYNC_AUTH_SECRET,
    baseURL: config.SYNC_API_URL,
    basePath: "/api/auth",
    trustedOrigins: [config.SYNC_WEB_URL],
    // Ghost runs better-auth too; cookies are shared per host, not per port, so the default names would overwrite Ghost's own session.
    advanced: { cookiePrefix: "ghost-sync" },
    database: drizzleAdapter(db, { provider: "pg", schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification } }),
    account: {
      encryptOAuthTokens: true,
      // A person's GitHub email rarely matches their Ghost one; linking is an explicit act from a signed-in session.
      accountLinking: { enabled: true, trustedProviders: ["ghost", "github"], allowDifferentEmails: true },
    },
    socialProviders: {
      github: { clientId: config.GITHUB_APP_CLIENT_ID, clientSecret: config.GITHUB_APP_CLIENT_SECRET, disableSignUp: true },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "ghost",
            clientId: config.GHOST_APP_CLIENT_ID,
            clientSecret: config.GHOST_APP_CLIENT_SECRET,
            authorizationUrl: `${config.GHOST_API_URL}/login/oauth/authorize`,
            tokenUrl: `${config.GHOST_API_URL}/login/oauth/access_token`,
            // Ghost answers `/user` in GitHub's shape, which carries no OIDC claims.
            getUserInfo: async (tokens) => {
              const response = await fetch(`${config.GHOST_API_URL}/api/v3/user`, {
                headers: { authorization: `Bearer ${tokens.accessToken}`, accept: "application/vnd.github+json" },
                signal: AbortSignal.timeout(30_000),
              });
              if (!response.ok) return null;
              const me = (await response.json()) as GhostUser;
              if (!me.email) return null;
              return { id: String(me.id), name: me.name ?? me.login, email: me.email, image: me.avatar_url ?? undefined, emailVerified: true };
            },
          },
        ],
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** The user's own token for `side`, refreshed when expired; null when that side is not linked or the refresh fails. */
export async function userToken(auth: Auth, db: Database, userId: string, side: Side): Promise<string | null> {
  const [linked] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, side)));
  if (!linked) return null;
  try {
    const { accessToken } = await auth.api.getAccessToken({ body: { accountId: linked.id, userId } });
    return accessToken ?? null;
  } catch {
    // A refresh the host refuses means the user revoked us or the token aged out; they must sign in or link again.
    return null;
  }
}
