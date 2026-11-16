import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAppAuth } from "./apps.ts";
import { createAuth, userToken as storedUserToken } from "./auth.ts";
import type { Config } from "./config.ts";
import type * as schema from "./db/schema.ts";
import { fetchBoth, fetchPullHead, isAncestor, pushRef, type Remote } from "./git.ts";
import { createQueue } from "./queue.ts";
import { ownerIsAdmin, reconcileSync, startReconcileTimer } from "./reconcile.ts";
import { createRest, type Rest, RestError } from "./rest.ts";
import { type RouteDeps, setupRoutes } from "./routes/setup.ts";
import { syncRoutes } from "./routes/syncs.ts";
import type { Side } from "./side.ts";
import { createStore, type SyncRow } from "./store.ts";
import type { SyncContext } from "./sync/context.ts";
import { runAction } from "./sync/run.ts";
import { webhookRoutes } from "./webhooks.ts";

export type Hosts = Record<Side, { api: string; graphql: string; git: string }>;

/** What a test swaps out: the network the hosts are reached through, where they live, and who is signed in. Production passes none. */
export type ServerOverrides = {
  fetch?: typeof globalThis.fetch;
  hosts?: Hosts;
  currentUser?: RouteDeps["currentUser"];
  userToken?: (userId: string, side: Side) => Promise<string | null>;
};

/** The whole sync API: routes, webhooks, the durable queue and the reconcile timer, which `start` sets running. */
export function createServer(config: Config, db: PostgresJsDatabase<typeof schema>, overrides: ServerOverrides = {}) {
  const store = createStore(db);
  const auth = createAuth(db, config);
  const fetch = overrides.fetch ?? globalThis.fetch;
  const hosts: Hosts = overrides.hosts ?? {
    ghost: { api: `${config.GHOST_API_URL}/api/v3`, graphql: `${config.GHOST_API_URL}/api/graphql`, git: config.GHOST_API_URL },
    github: { api: "https://api.github.com", graphql: "https://api.github.com/graphql", git: "https://github.com" },
  };
  const installUrl: Record<Side, string> = {
    ghost: `${config.GHOST_WEB_URL}/apps/${config.GHOST_APP_SLUG}/installations/new`,
    github: `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`,
  };
  const slugs: Record<Side, string> = { ghost: config.GHOST_APP_SLUG, github: config.GITHUB_APP_SLUG };
  /** The logins our own writes come back as. */
  const bots: Record<Side, string> = { ghost: `${slugs.ghost}[bot]`, github: `${slugs.github}[bot]` };
  const appAuth = {
    ghost: createAppAuth({ appId: config.GHOST_APP_ID, privateKey: config.GHOST_APP_PRIVATE_KEY, apiUrl: hosts.ghost.api, fetch }),
    github: createAppAuth({ appId: config.GITHUB_APP_ID, privateKey: config.GITHUB_APP_PRIVATE_KEY, apiUrl: hosts.github.api, fetch }),
  };
  const git = { fetchBoth, fetchPullHead, isAncestor, pushRef };
  const userToken = overrides.userToken ?? ((userId: string, side: Side) => storedUserToken(auth, db, userId, side));
  const restOn = (side: Side, token: () => Promise<string>) => createRest({ baseUrl: hosts[side].api, graphqlUrl: hosts[side].graphql, token, fetch });
  const gitUrl = (side: Side, fullName: string) => `${hosts[side].git}/${fullName}.git`;
  const mirrorOf = (syncId: string) => join(config.SYNC_DATA_DIR, `${syncId}.git`);

  /** A client acting as the user; every request asks for the token again, so an expired one is refreshed in between. */
  async function userRest(userId: string, side: Side): Promise<Rest | null> {
    if (!(await userToken(userId, side))) return null;
    return restOn(side, async () => {
      const token = await userToken(userId, side);
      if (!token) throw new RestError(401, { message: `The ${side} link was revoked` });
      return token;
    });
  }

  function contextFor(sync: SyncRow): SyncContext {
    const installations = { ghost: sync.ghostInstallationId, github: sync.githubInstallationId };
    const tokenFor = (side: Side) => () => {
      const id = installations[side];
      if (id === null) throw new RestError(404, { message: `No ${side} installation covers this repository` });
      return appAuth[side].installationToken(id);
    };
    const [ghostOwner, ghostName] = sync.ghostFullName.split("/") as [string, string];
    const [githubOwner, githubName] = sync.githubFullName.split("/") as [string, string];
    return {
      sync,
      rest: { ghost: restOn("ghost", tokenFor("ghost")), github: restOn("github", tokenFor("github")) },
      repo: { ghost: { owner: ghostOwner, name: ghostName }, github: { owner: githubOwner, name: githubName } },
      remote: async (): Promise<Record<Side, Remote>> => ({
        ghost: { url: gitUrl("ghost", sync.ghostFullName), token: await tokenFor("ghost")() },
        github: { url: gitUrl("github", sync.githubFullName), token: await tokenFor("github")() },
      }),
      git,
      dir: mirrorOf(sync.id),
      bot: bots,
      appSlug: slugs,
      store,
    };
  }

  const ownerCanAdmin = async (sync: SyncRow) =>
    ownerIsAdmin({ ghost: await userRest(sync.ownerId, "ghost"), github: await userRest(sync.ownerId, "github") }, sync);
  const reconcile = (ctx: SyncContext) => reconcileSync(ctx, () => ownerCanAdmin(ctx.sync));

  const queue = createQueue({
    store,
    run: async (syncId, action) => {
      const sync = await store.getSync(syncId);
      // A job queued before its sync was paused, disconnected or deleted waits for the reconcile that follows resuming.
      if (!sync || sync.status === "paused" || sync.status === "disconnected") return;
      await runAction(contextFor(sync), action, reconcile);
    },
    onError: (syncId, error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`sync job failed${syncId ? ` for ${syncId}` : ""}:`, error);
      if (syncId) store.addActivity({ syncId, direction: null, kind: "job", summary: "A queued job failed", error: message }).catch(() => {});
    },
  });

  /** What a first sync would do to the branches, fetched with the user's own tokens into a mirror thrown away after. */
  async function compareRefs(userId: string, ghostFullName: string, githubFullName: string) {
    const tokens = { ghost: await userToken(userId, "ghost"), github: await userToken(userId, "github") };
    const dir = join(await mkdtemp(join(tmpdir(), "sync-preview-")), "mirror.git");
    try {
      const refs = await fetchBoth(dir, {
        ghost: { url: gitUrl("ghost", ghostFullName), token: tokens.ghost },
        github: { url: gitUrl("github", githubFullName), token: tokens.github },
      });
      const counts = { toGhost: 0, toGitHub: 0, diverged: 0 };
      for (const ref of new Set([...refs.ghost.keys(), ...refs.github.keys()])) {
        const ghost = refs.ghost.get(ref);
        const github = refs.github.get(ref);
        if (ghost === github) continue;
        if (!ghost) counts.toGhost++;
        else if (!github) counts.toGitHub++;
        else if (await isAncestor(dir, ghost, github)) counts.toGhost++;
        else if (await isAncestor(dir, github, ghost)) counts.toGitHub++;
        else counts.diverged++;
      }
      return counts;
    } finally {
      await rm(join(dir, ".."), { recursive: true, force: true });
    }
  }

  async function appInstallation(side: Side, fullName: string) {
    try {
      return (await restOn(side, async () => appAuth[side].jwt()).request<{ id: number }>("GET", `/repos/${fullName}/installation`)).id;
    } catch (error) {
      if (error instanceof RestError && error.status === 404) return null;
      throw error;
    }
  }

  const deps: RouteDeps = {
    store,
    currentUser:
      overrides.currentUser ??
      (async (c) => {
        const session = await auth.api.getSession({ headers: c.req.raw.headers });
        return session ? { id: session.user.id } : null;
      }),
    userRest,
    appInstallation,
    installUrl,
    compareRefs,
    reconcileNow: (syncId) => queue.push(syncId, { kind: "reconcile" }),
    removeMirror: (syncId) => rm(mirrorOf(syncId), { recursive: true, force: true }),
  };

  const app = new Hono();
  app.use("/api/*", cors({ origin: config.SYNC_WEB_URL, credentials: true, allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.get("/health", (c) => c.text("ok"));
  app.route("/", webhookRoutes({ secrets: { ghost: config.GHOST_APP_WEBHOOK_SECRET, github: config.GITHUB_APP_WEBHOOK_SECRET }, bots, store, queue }));
  app.route("/", setupRoutes(deps));
  app.route("/", syncRoutes(deps));

  return {
    app,
    store,
    queue,
    /** Starts the queue's workers and the reconcile timer; returns what stops them. */
    start() {
      queue.start();
      const timer = startReconcileTimer({ store, queue, intervalSeconds: config.RECONCILE_INTERVAL });
      return async () => {
        timer.stop();
        await queue.stop();
      };
    },
  };
}
