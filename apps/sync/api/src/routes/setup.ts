import { type Context, Hono, type MiddlewareHandler } from "hono";
import postgres from "postgres";
import { z } from "zod";
import { type Rest, RestError } from "../rest.ts";
import { SIDE_NAME, type Side } from "../side.ts";
import type { Store } from "../store.ts";
import { ghostKeyOfNodeId } from "../sync/issues.ts";

export type RefCounts = { toGhost: number; toGitHub: number; diverged: number };

export type RouteDeps = {
  store: Store;
  currentUser: (c: Context) => Promise<{ id: string } | null>;
  /** A client acting as the user on `side`, null when that side is not linked or its token cannot be refreshed. */
  userRest: (userId: string, side: Side) => Promise<Rest | null>;
  /** The app's installation covering `fullName` on `side`, null when it is not installed there. */
  appInstallation: (side: Side, fullName: string) => Promise<number | null>;
  installUrl: Record<Side, string>;
  /** Each host's web origin, where `<origin>/<full name>` is a repository's page. */
  webUrl: Record<Side, string>;
  /** What a first sync would do to the branches, from a fetch of both repositories into a throwaway mirror. */
  compareRefs: (userId: string, ghostFullName: string, githubFullName: string) => Promise<RefCounts>;
  reconcileNow: (syncId: string) => unknown;
  removeMirror: (syncId: string) => Promise<void>;
};

type HostRepo = { id: number; node_id: string; full_name: string; private: boolean; permissions?: { admin?: boolean } };

const SIDES: Side[] = ["ghost", "github"];
const repoIdOf = (side: Side, repo: HostRepo) => (side === "ghost" ? ghostKeyOfNodeId(repo.node_id) : String(repo.id));
const fullName = z.string().regex(/^[^/\s]+\/[^/\s]+$/);
const existing = z.object({ fullName });
const SyncRequest = z.object({
  ghost: existing,
  github: z.union([existing, z.object({ create: z.object({ owner: z.string().min(1), name: z.string().min(1), private: z.boolean() }) })]),
  /** False copies only what happens from now on. */
  backfill: z.boolean().default(true),
});
const PreviewRequest = z.object({ ghost: existing, github: existing });

/** Thrown inside a route to answer with `status` and a message the web shows as is. */
class Refusal extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function all<T>(pages: AsyncGenerator<T>) {
  const items: T[] = [];
  for await (const item of pages) items.push(item);
  return items;
}

/** The repository as the user sees it, refusing one they cannot see or do not administer. */
async function administered(rest: Rest, side: Side, name: string) {
  let repo: HostRepo;
  try {
    repo = await rest.request<HostRepo>("GET", `/repos/${name}`);
  } catch (error) {
    if (error instanceof RestError && [403, 404].includes(error.status)) throw new Refusal(403, `You cannot see ${name} on ${SIDE_NAME[side]}.`);
    throw error;
  }
  if (repo.permissions?.admin !== true) throw new Refusal(403, `You need to be an admin of ${name} on ${SIDE_NAME[side]}.`);
  return repo;
}

export type RouteEnv = { Variables: { userId: string } };

/** Answers 401 to anyone not signed in, and hands the rest of the route the user's id. */
export const signedIn =
  (deps: Pick<RouteDeps, "currentUser">): MiddlewareHandler<RouteEnv> =>
  async (c, next) => {
    const user = await deps.currentUser(c);
    if (!user) return c.json({ error: "Sign in first." }, 401);
    c.set("userId", user.id);
    await next();
  };

/** The pickers, the preview and creating a sync: everything the new-sync page asks. */
export function setupRoutes(deps: RouteDeps) {
  const app = new Hono<RouteEnv>();

  app.onError((error, c) => {
    if (error instanceof Refusal) return c.json({ error: error.message, ...error.extra }, error.status);
    throw error;
  });
  app.use("/api/*", signedIn(deps));

  const restFor = async (userId: string, side: Side) => {
    const rest = await deps.userRest(userId, side);
    if (!rest) throw new Refusal(400, side === "github" ? "Link GitHub first." : "Sign in with Ghost again.");
    return rest;
  };
  const body = async <T>(c: Context, schema: z.ZodType<T>) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new Refusal(400, "The request is malformed.");
    return parsed.data;
  };

  app.get("/api/me", async (c) => {
    const userId = c.get("userId");
    const login = async (side: Side) => {
      const rest = await deps.userRest(userId, side);
      return rest ? { login: (await rest.request<{ login: string }>("GET", "/user")).login } : null;
    };
    return c.json({ ghost: await login("ghost"), github: await login("github") });
  });

  app.get("/api/repositories/:side", async (c) => {
    const side = c.req.param("side");
    if (!SIDES.includes(side as Side)) return c.json({ error: "No such side." }, 404);
    const rest = await restFor(c.get("userId"), side as Side);
    const repositories = [];
    for (const installation of await all(rest.paginate<{ id: number }>("/user/installations"))) {
      for (const repo of await all(rest.paginate<HostRepo>(`/user/installations/${installation.id}/repositories`))) {
        if (repo.permissions?.admin !== true) continue;
        const id = repoIdOf(side as Side, repo);
        repositories.push({ id, fullName: repo.full_name, private: repo.private, synced: (await deps.store.findSyncByRepo(side as Side, id)) !== null });
      }
    }
    return c.json({ installUrl: deps.installUrl[side as Side], repositories });
  });

  app.get("/api/github/owners", async (c) => {
    const rest = await restFor(c.get("userId"), "github");
    const owners = [(await rest.request<{ login: string }>("GET", "/user")).login];
    for (const org of await all(rest.paginate<{ login: string }>("/user/orgs"))) {
      const membership = await rest.request<{ role: string }>("GET", `/user/memberships/orgs/${org.login}`);
      if (membership.role === "admin") owners.push(org.login);
    }
    return c.json({ owners });
  });

  app.post("/api/syncs/preview", async (c) => {
    const { ghost, github } = await body(c, PreviewRequest);
    const userId = c.get("userId");
    const rest = { ghost: await restFor(userId, "ghost"), github: await restFor(userId, "github") };
    await administered(rest.ghost, "ghost", ghost.fullName);
    await administered(rest.github, "github", github.fullName);
    const count = async (side: Side, name: string) => {
      const items = await all(rest[side].paginate<{ pull_request?: unknown }>(`/repos/${name}/issues?state=all`));
      const pulls = items.filter((item) => item.pull_request).length;
      return { issues: items.length - pulls, pulls };
    };
    const fromGhost = await count("ghost", ghost.fullName);
    const fromGithub = await count("github", github.fullName);
    return c.json({
      branches: await deps.compareRefs(userId, ghost.fullName, github.fullName),
      issues: { toGhost: fromGithub.issues, toGitHub: fromGhost.issues },
      pulls: { toGhost: fromGithub.pulls, toGitHub: fromGhost.pulls },
    });
  });

  app.post("/api/syncs", async (c) => {
    const request = await body(c, SyncRequest);
    const userId = c.get("userId");
    const ghostRest = await restFor(userId, "ghost");
    const githubRest = await restFor(userId, "github");

    // Everything about the Ghost side is checked before a GitHub repository might be created for it.
    const ghostRepo = await administered(ghostRest, "ghost", request.ghost.fullName);
    const ghostRepoId = repoIdOf("ghost", ghostRepo);
    if (await deps.store.findSyncByRepo("ghost", ghostRepoId)) throw new Refusal(409, `${ghostRepo.full_name} is already synced.`);
    const ghostInstallationId = await deps.appInstallation("ghost", ghostRepo.full_name);
    if (ghostInstallationId === null) throw new Refusal(403, `Install the app on ${ghostRepo.full_name} on Ghost first.`, { installUrl: deps.installUrl.ghost });

    let githubRepo: HostRepo;
    if ("create" in request.github) {
      const { owner, name, private: isPrivate } = request.github.create;
      const me = (await githubRest.request<{ login: string }>("GET", "/user")).login;
      const path = owner.toLowerCase() === me.toLowerCase() ? "/user/repos" : `/orgs/${owner}/repos`;
      githubRepo = await githubRest.request<HostRepo>("POST", path, { name, private: isPrivate, auto_init: false });
    } else {
      githubRepo = await administered(githubRest, "github", request.github.fullName);
    }
    const githubRepoId = repoIdOf("github", githubRepo);
    if (await deps.store.findSyncByRepo("github", githubRepoId)) throw new Refusal(409, `${githubRepo.full_name} is already synced.`);
    const githubInstallationId = await deps.appInstallation("github", githubRepo.full_name);
    // A repository created just now is covered only if the installation takes all repositories; otherwise its owner adds it and `installation_repositories.added` starts the sync.
    if (githubInstallationId === null && !("create" in request.github)) {
      throw new Refusal(403, `Install the app on ${githubRepo.full_name} on GitHub first.`, { installUrl: deps.installUrl.github });
    }

    let sync;
    try {
      sync = await deps.store.createSync({
        ownerId: userId,
        ghostRepoId,
        ghostFullName: ghostRepo.full_name,
        githubRepoId,
        githubFullName: githubRepo.full_name,
        ghostInstallationId,
        githubInstallationId,
        backfill: request.backfill,
      });
    } catch (error) {
      // Two requests pairing the same repository at once: the database's unique constraint decides.
      if (error instanceof postgres.PostgresError && error.code === "23505") throw new Refusal(409, "One of these repositories was synced a moment ago.");
      throw error;
    }
    if (githubInstallationId === null) {
      await deps.store.updateSync(sync.id, { status: "disconnected", disconnectReason: `GitHub app does not cover ${githubRepo.full_name} yet` });
      return c.json({ id: sync.id, installUrl: deps.installUrl.github }, 201);
    }
    await deps.reconcileNow(sync.id);
    return c.json({ id: sync.id }, 201);
  });

  return app;
}
