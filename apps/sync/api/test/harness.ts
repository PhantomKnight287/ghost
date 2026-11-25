import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadConfig } from "../src/config.ts";
import * as schema from "../src/db/schema.ts";
import { createServer } from "../src/server.ts";
import type { Side } from "../src/side.ts";
import { createFakeHost } from "./fake-host.ts";

export const databaseUrl = process.env.TEST_DATABASE_URL;

/** One owner, signed in as `bob` on Ghost and `bob-gh` on GitHub. */
export const OWNER = "user-1";
export const LOGINS: Record<Side, string> = { ghost: "bob", github: "bob-gh" };
export const SLUGS: Record<Side, string> = { ghost: "sync-bot", github: "sync-bot-gh" };
export const BOTS: Record<Side, string> = { ghost: "sync-bot[bot]", github: "sync-bot-gh[bot]" };
const ROUNDS = 25;

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const databases = new Map<string, Promise<ReturnType<typeof drizzle<typeof schema>>>>();

/** A database for one test file: Bun runs test files concurrently, and one file's clean-up must never land in the middle of another's test. */
function databaseFor(file: string) {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const name = `sync_e2e_${basename(file, ".test.ts").replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
  let ready = databases.get(name);
  if (!ready) {
    ready = (async () => {
      const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
      if (!exists) await admin.unsafe(`create database "${name}"`);
      await admin.end();
      const url = new URL(databaseUrl);
      url.pathname = `/${name}`;
      const db = drizzle(postgres(url.toString(), { max: 4, onnotice: () => {} }), { schema });
      await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` });
      return db;
    })();
    databases.set(name, ready);
  }
  return ready;
}

/**
 * The whole sync API against two fake hosts: real Postgres store and queue, real git mirrors, real webhook pipeline and routes. Only the network and the signed-in user are stand-ins.
 */
export async function startWorld(file: string) {
  const db = await databaseFor(file);
  for (const table of [schema.job, schema.link, schema.ref, schema.activity, schema.delivery, schema.sync, schema.session, schema.account, schema.verification, schema.user]) await db.delete(table);

  const root = mkdtempSync(join(tmpdir(), "sync-world-"));
  const ghost = createFakeHost({ side: "ghost", origin: "http://ghost.test", root, slug: SLUGS.ghost, webhookSecret: "whsec_ghost", installationId: 11 });
  const github = createFakeHost({ side: "github", origin: "http://github.test", root, slug: SLUGS.github, webhookSecret: "whsec_github", installationId: 22 });
  const hosts = { ghost, github };
  const linked = { ghost: true, github: true };
  const people = new Map<string, Record<Side, string>>([[OWNER, LOGINS]]);

  const config = loadConfig({
    SYNC_DATABASE_URL: databaseUrl ?? "",
    SYNC_AUTH_SECRET: "s".repeat(32),
    SYNC_API_URL: "http://sync.test",
    SYNC_WEB_URL: "http://sync-web.test",
    GHOST_API_URL: "http://ghost.test",
    GHOST_WEB_URL: "http://ghost-web.test",
    GHOST_APP_ID: "4",
    GHOST_APP_SLUG: SLUGS.ghost,
    GHOST_APP_PRIVATE_KEY: privateKey,
    GHOST_APP_CLIENT_ID: "Iv1.ghost",
    GHOST_APP_CLIENT_SECRET: "ghost_cs",
    GHOST_APP_WEBHOOK_SECRET: "whsec_ghost",
    GITHUB_APP_ID: "9",
    GITHUB_APP_SLUG: SLUGS.github,
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_APP_CLIENT_ID: "Iv1.github",
    GITHUB_APP_CLIENT_SECRET: "github_secret",
    GITHUB_APP_WEBHOOK_SECRET: "whsec_github",
    SYNC_DATA_DIR: join(root, "mirrors"),
    RECONCILE_INTERVAL: "3600",
  });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const origin = new URL(request.url).origin;
    if (origin === ghost.origin) return ghost.fetch(request);
    if (origin === github.origin) return github.fetch(request);
    throw new Error(`The world has no host at ${origin}`);
  }) as typeof globalThis.fetch;

  const server = createServer(config, db, {
    fetch,
    hosts: {
      ghost: { api: `${ghost.origin}/api/v3`, graphql: `${ghost.origin}/api/graphql`, git: `file://${root}/ghost` },
      github: { api: github.origin, graphql: `${github.origin}/graphql`, git: `file://${root}/github` },
    },
    currentUser: async (c) => (c.req.header("x-test-user") ? { id: c.req.header("x-test-user") ?? "" } : null),
    userToken: async (userId, side) => {
      const logins = people.get(userId);
      return logins && (userId !== OWNER || linked[side]) ? hosts[side].userToken(logins[side]) : null;
    },
  });

  /** Calls the sync API as the owner. */
  async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const response = await server.app.request(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-test-user": OWNER },
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as T };
  }

  /** Delivers every webhook both hosts have sent and runs every queued job, until nothing new happens. More rounds than `ROUNDS` means two sides are echoing each other. */
  async function settle() {
    for (let round = 0; round < ROUNDS; round++) {
      const deliveries = [...ghost.takeDeliveries(), ...github.takeDeliveries()];
      for (const request of deliveries) {
        const response = await server.app.fetch(request);
        if (response.status >= 300) throw new Error(`webhook ${request.headers.get("x-ghost-event") ?? request.headers.get("x-github-event")} answered ${response.status}: ${await response.text()}`);
      }
      await server.queue.idle();
      if (deliveries.length === 0) return;
    }
    throw new Error(`Ghost Sync did not settle in ${ROUNDS} rounds: the sides are echoing each other`);
  }

  /** Pairs two repositories through the API, as the web does, and lets the first sync finish. */
  async function pair(ghostFullName = "acme/app", githubFullName = "acme-gh/app", options: { backfill?: boolean } = {}) {
    const created = await call<{ id: string }>("POST", "/api/syncs", { ghost: { fullName: ghostFullName }, github: { fullName: githubFullName }, ...options });
    if (created.status !== 201) throw new Error(`pairing answered ${created.status}: ${JSON.stringify(created.body)}`);
    await settle();
    return created.body.id;
  }

  /** Signs `userId` in to Ghost Sync with both sides linked, as `logins`, the way the web's sign-in and GitHub link would. */
  async function link(userId: string, logins: Record<Side, string>) {
    await db.insert(schema.user).values({ id: userId, name: logins.ghost, email: `${logins.ghost}@example.com` });
    await db.insert(schema.account).values((["ghost", "github"] as const).map((side) => ({ id: `${userId}-${side}`, userId, providerId: side, accountId: String(hosts[side].userId(logins[side])) })));
    people.set(userId, logins);
  }

  return { ghost, github, hosts, server, store: server.store, call, settle, pair, linked, link, root };
}

export type World = Awaited<ReturnType<typeof startWorld>>;

/** Repositories on both sides that the owner administers and the app is installed on. */
export function twoRepositories(world: World) {
  const ghostRepo = world.ghost.createRepo("acme/app", { admins: [LOGINS.ghost] });
  const githubRepo = world.github.createRepo("acme-gh/app", { admins: [LOGINS.github] });
  return { ghostRepo, githubRepo };
}
