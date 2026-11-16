import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createAuth, userToken } from "./auth.ts";
import { loadConfig } from "./config.ts";
import * as schema from "./db/schema.ts";

const url = process.env.TEST_DATABASE_URL;

/** Ghost's OAuth endpoints and `/api/v3/user`, as a sign-in sees them. */
function fakeGhost() {
  const seen: { tokenRequests: URLSearchParams[] } = { tokenRequests: [] };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/login/oauth/access_token") {
        seen.tokenRequests.push(new URLSearchParams(await request.text()));
        return Response.json({ access_token: "ghu_signin", refresh_token: "ghr_signin", token_type: "bearer", expires_in: 28800, scope: "" });
      }
      if (path === "/api/v3/user") {
        if (request.headers.get("authorization") !== "Bearer ghu_signin") return new Response(null, { status: 401 });
        return Response.json({ id: 7, login: "bob", name: null, email: "bob@example.com", avatar_url: "https://ghost.example.com/bob.png" });
      }
      return new Response(null, { status: 404 });
    },
  });
  return { server, seen };
}

describe.skipIf(!url)("sign in with Ghost", () => {
  const client = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const ghost = fakeGhost();
  const config = loadConfig({
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "s".repeat(32),
    BETTER_AUTH_URL: "http://sync-api.test",
    SYNC_WEB_URL: "http://sync.test",
    GHOST_API_URL: `http://localhost:${ghost.server.port}`,
    GHOST_APP_ID: "4",
    GHOST_APP_SLUG: "sync-bot",
    GHOST_APP_PRIVATE_KEY: "pem",
    GHOST_APP_CLIENT_ID: "Iv1.test",
    GHOST_APP_CLIENT_SECRET: "ghost_cs_test",
    GHOST_APP_WEBHOOK_SECRET: "w",
    GITHUB_APP_ID: "9",
    GITHUB_APP_SLUG: "sync-bot",
    GITHUB_APP_PRIVATE_KEY: "pem",
    GITHUB_APP_CLIENT_ID: "Iv1.github",
    GITHUB_APP_CLIENT_SECRET: "github_secret",
    GITHUB_APP_WEBHOOK_SECRET: "w",
  });
  const auth = createAuth(db, config);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` });
  });
  beforeEach(async () => {
    for (const table of [schema.session, schema.account, schema.verification, schema.user]) await db.delete(table);
    ghost.seen.tokenRequests.length = 0;
  });
  afterAll(async () => {
    ghost.server.stop(true);
    await client.end();
  });

  /** Starts a Ghost sign-in, has "Ghost" approve it, and returns the callback's response. */
  async function signIn() {
    const start = await auth.handler(
      new Request("http://sync-api.test/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://sync.test" },
        body: JSON.stringify({ provider: "ghost", callbackURL: "http://sync.test/" }),
      }),
    );
    const { url: authorize } = (await start.json()) as { url: string };
    const cookies = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const state = new URL(authorize).searchParams.get("state");
    const callback = await auth.handler(new Request(`http://sync-api.test/api/auth/callback/ghost?code=c0de&state=${state}`, { headers: { cookie: cookies } }));
    return { authorize: new URL(authorize), callback };
  }

  test("sends the user to Ghost's authorize page with the app's client id and our callback", async () => {
    const { authorize } = await signIn();
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${config.GHOST_API_URL}/login/oauth/authorize`);
    expect(authorize.searchParams.get("client_id")).toBe("Iv1.test");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://sync-api.test/api/auth/callback/ghost");
  });

  test("the callback creates the user from Ghost's /user and starts a session", async () => {
    const { callback } = await signIn();
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("http://sync.test/");
    expect(callback.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(true);
    expect(ghost.seen.tokenRequests[0]?.get("code")).toBe("c0de");
    const [created] = await db.select().from(schema.user);
    expect(created).toMatchObject({ name: "bob", email: "bob@example.com", emailVerified: true });
  });

  test("tokens are stored encrypted, and userToken hands back the real one", async () => {
    await signIn();
    const [user] = await db.select().from(schema.user);
    const [stored] = await db.select().from(schema.account).where(eq(schema.account.providerId, "ghost"));
    expect(stored?.accountId).toBe("7");
    expect(stored?.accessToken).not.toContain("ghu_signin");
    expect(stored?.refreshToken).not.toContain("ghr_signin");
    expect(await userToken(auth, db, user?.id ?? "", "ghost")).toBe("ghu_signin");
  });

  test("userToken is null for a side the user has not linked", async () => {
    await signIn();
    const [user] = await db.select().from(schema.user);
    expect(await userToken(auth, db, user?.id ?? "", "github")).toBeNull();
  });

  test("a Ghost account without an email cannot sign in", async () => {
    ghost.server.reload({
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/login/oauth/access_token") return Response.json({ access_token: "ghu_signin", token_type: "bearer" });
        return Response.json({ id: 8, login: "noemail", name: null, email: null, avatar_url: null });
      },
    });
    const { callback } = await signIn();
    expect(callback.headers.get("location")).toContain("error");
    expect(await db.select().from(schema.user)).toEqual([]);
  });
});
