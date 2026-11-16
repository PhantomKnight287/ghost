import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import postgres from "postgres";
import { createAppAuth } from "./apps.ts";
import { createAuth, userToken } from "./auth.ts";
import { loadConfig } from "./config.ts";
import * as schema from "./db/schema.ts";
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

const config = loadConfig(process.env);
const db = drizzle(postgres(config.SYNC_DATABASE_URL), { schema });
const store = createStore(db);
const auth = createAuth(db, config);

const hosts: Record<Side, { api: string; graphql: string; git: string; installUrl: string }> = {
  ghost: {
    api: `${config.GHOST_API_URL}/api/v3`,
    graphql: `${config.GHOST_API_URL}/api/graphql`,
    git: config.GHOST_API_URL,
    installUrl: `${config.GHOST_WEB_URL}/apps/${config.GHOST_APP_SLUG}/installations/new`,
  },
  github: {
    api: "https://api.github.com",
    graphql: "https://api.github.com/graphql",
    git: "https://github.com",
    installUrl: `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`,
  },
};
const slugs: Record<Side, string> = { ghost: config.GHOST_APP_SLUG, github: config.GITHUB_APP_SLUG };
/** The logins our own writes come back as. */
const bots: Record<Side, string> = { ghost: `${slugs.ghost}[bot]`, github: `${slugs.github}[bot]` };
const appAuth = {
  ghost: createAppAuth({ appId: config.GHOST_APP_ID, privateKey: config.GHOST_APP_PRIVATE_KEY, apiUrl: hosts.ghost.api }),
  github: createAppAuth({ appId: config.GITHUB_APP_ID, privateKey: config.GITHUB_APP_PRIVATE_KEY, apiUrl: hosts.github.api }),
};
const git = { fetchBoth, fetchPullHead, isAncestor, pushRef };
const restOn = (side: Side, token: () => Promise<string>) => createRest({ baseUrl: hosts[side].api, graphqlUrl: hosts[side].graphql, token });
const mirrorOf = (syncId: string) => join(config.SYNC_DATA_DIR, `${syncId}.git`);

/** A client acting as the user; every request asks for the token again, so an expired one is refreshed in between. */
async function userRest(userId: string, side: Side): Promise<Rest | null> {
  if (!(await userToken(auth, db, userId, side))) return null;
  return restOn(side, async () => {
    const token = await userToken(auth, db, userId, side);
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
  const full = { ghost: sync.ghostFullName, github: sync.githubFullName };
  const [ghostOwner, ghostName] = full.ghost.split("/") as [string, string];
  const [githubOwner, githubName] = full.github.split("/") as [string, string];
  return {
    sync,
    rest: { ghost: restOn("ghost", tokenFor("ghost")), github: restOn("github", tokenFor("github")) },
    repo: { ghost: { owner: ghostOwner, name: ghostName }, github: { owner: githubOwner, name: githubName } },
    remote: async (): Promise<Record<Side, Remote>> => ({
      ghost: { url: `${hosts.ghost.git}/${full.ghost}.git`, token: await tokenFor("ghost")() },
      github: { url: `${hosts.github.git}/${full.github}.git`, token: await tokenFor("github")() },
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
  const tokens = { ghost: await userToken(auth, db, userId, "ghost"), github: await userToken(auth, db, userId, "github") };
  const dir = join(await mkdtemp(join(tmpdir(), "sync-preview-")), "mirror.git");
  try {
    const refs = await fetchBoth(dir, {
      ghost: { url: `${hosts.ghost.git}/${ghostFullName}.git`, token: tokens.ghost },
      github: { url: `${hosts.github.git}/${githubFullName}.git`, token: tokens.github },
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
  currentUser: async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    return session ? { id: session.user.id } : null;
  },
  userRest,
  appInstallation,
  installUrl: { ghost: hosts.ghost.installUrl, github: hosts.github.installUrl },
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

queue.start();
startReconcileTimer({ store, queue, intervalSeconds: config.RECONCILE_INTERVAL });

export default { port: config.SYNC_PORT, fetch: app.fetch };
