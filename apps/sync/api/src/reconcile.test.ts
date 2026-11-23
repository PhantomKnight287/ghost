import { describe, expect, test } from "bun:test";
import { withMarker } from "./format.ts";
import { fakeGit } from "./lib/fake-git.ts";
import { type Routes, writes } from "./lib/fake-rest.ts";
import { fakeStore } from "./lib/fake-store.ts";
import { syncRow, testContext } from "./lib/test-context.ts";
import { ownerIsAdmin, reconcileSync, startReconcileTimer } from "./reconcile.ts";
import { RestError } from "./rest.ts";
import type { SyncAction } from "./sync/action.ts";

const owner = async () => true;
const firstList = (repo: string) => `GET /repos/${repo}/issues?state=all`;
const issue = (number: number, login: string, extra: Record<string, unknown> = {}) => ({ number, title: `#${number}`, body: "b", state: "open", user: { login }, labels: [], ...extra });

/** Ghost has open issue #12 by bob and closed issue #13; GitHub has none. */
function firstSync(extraGhost: Routes = {}, extraGithub: Routes = {}) {
  return testContext({
    sync: { status: "backfilling", lastReconciledAt: null },
    git: fakeGit(),
    ghost: {
      [firstList("acme/app")]: [issue(12, "bob"), issue(13, "bob", { state: "closed" })],
      "GET /repos/acme/app/issues/12": issue(12, "bob"),
      "GET /repos/acme/app/issues/13": issue(13, "bob", { state: "closed" }),
      "GET /repos/acme/app/issues/12/comments": [],
      "GET /repos/acme/app/issues/13/comments": [],
      ...extraGhost,
    },
    github: {
      [firstList("acme-gh/app")]: [],
      "POST /repos/acme-gh/app/issues": (body: unknown) => ({ number: (body as { title: string }).title === "#12" ? 5 : 6 }),
      "PATCH /repos/acme-gh/app/issues/5": {},
      "PATCH /repos/acme-gh/app/issues/6": {},
      ...extraGithub,
    },
  });
}

describe("reconcileSync", () => {
  test("an owner who lost admin stops the sync before anything runs", async () => {
    const ctx = firstSync();
    await reconcileSync(ctx, async () => false);
    expect(await ctx.store.getSync(ctx.sync.id)).toMatchObject({ status: "disconnected", disconnectReason: "owner lost access" });
    expect(ctx.ghost.calls).toEqual([]);
    expect(ctx.git.pushes).toEqual([]);
  });

  test("the first run copies refs and every issue, open and closed, then goes active", async () => {
    const ctx = firstSync();
    ctx.git.repos.ghost.set("refs/heads/main", "m1");
    const before = Date.now();
    await reconcileSync(ctx, owner);
    expect(ctx.git.pushes).toEqual([{ side: "github", ref: "refs/heads/main", sha: "m1", expected: null }]);
    expect(writes(ctx.github).filter((c) => c.method === "POST").map((c) => (c.body as { body: string }).body)).toEqual([withMarker("b", "ghost", "bob"), withMarker("b", "ghost", "bob")]);
    const sync = await ctx.store.getSync(ctx.sync.id);
    expect(sync?.status).toBe("active");
    expect(sync?.lastReconciledAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(ctx.store.activity).toContainEqual(expect.objectContaining({ kind: "reconcile", summary: "First sync finished", error: null }));
  });

  test("a second first-run over the same repositories creates nothing new", async () => {
    const ctx = firstSync({}, { "GET /repos/acme-gh/app/issues/5": issue(5, "ghost-sync[bot]"), "GET /repos/acme-gh/app/issues/6": issue(6, "ghost-sync[bot]") });
    await reconcileSync(ctx, owner);
    await ctx.store.updateSync(ctx.sync.id, { lastReconciledAt: null });
    ctx.sync.lastReconciledAt = null;
    const posts = () => writes(ctx.github).filter((c) => c.method === "POST").length;
    const first = posts();
    await reconcileSync(ctx, owner);
    expect(posts()).toBe(first);
  });

  test("copies made by our bot on the other side are not copied back", async () => {
    const ctx = firstSync({}, { [firstList("acme-gh/app")]: [issue(5, "ghost-sync[bot]")], "GET /repos/acme-gh/app/issues/5": issue(5, "ghost-sync[bot]"), "GET /repos/acme-gh/app/issues/5/comments": [] });
    await reconcileSync(ctx, owner);
    expect(writes(ctx.ghost).filter((c) => c.method === "POST")).toEqual([]);
  });

  test("comments on listed issues follow", async () => {
    const ctx = firstSync({ "GET /repos/acme/app/issues/12/comments": [{ id: 301, node_id: "IC_x", body: "hi", user: { login: "bob" } }] }, { "POST /repos/acme-gh/app/issues/5/comments": { id: 9001 } });
    await reconcileSync(ctx, owner);
    expect(writes(ctx.github).some((c) => c.path === "/repos/acme-gh/app/issues/5/comments")).toBe(true);
  });

  test("pull requests in the list go through pulls, with their reviews and line comments", async () => {
    const pull = { ...issue(3, "bob"), pull_request: {} };
    const ctx = firstSync({
      [firstList("acme/app")]: [pull],
      "GET /repos/acme/app/pulls/3": { ...pull, draft: false, merged: false, head: { ref: "feat", sha: "h1", repo: { id: 1 } }, base: { ref: "main", sha: "m1", repo: { id: 1 } } },
      "GET /repos/acme/app/issues/3/comments": [],
      "GET /repos/acme/app/pulls/3/reviews": [],
      "GET /repos/acme/app/pulls/3/comments": [],
      "GET /repos/acme/app/commits/h1/check-runs": [],
    }, { "POST /repos/acme-gh/app/pulls": { number: 8 }, "GET /repos/acme-gh/app/commits/h1/check-runs": [] });
    ctx.git.repos.ghost.set("refs/heads/feat", "h1");
    ctx.git.repos.ghost.set("refs/heads/main", "m1");
    await reconcileSync(ctx, owner);
    expect(writes(ctx.github).map((c) => c.path)).toContain("/repos/acme-gh/app/pulls");
    expect(ctx.ghost.calls.map((c) => c.path)).toEqual(expect.arrayContaining(["/repos/acme/app/pulls/3/reviews", "/repos/acme/app/pulls/3/comments"]));
  });

  test("check runs on open pull request heads are copied", async () => {
    const pull = { ...issue(3, "bob"), pull_request: {} };
    const run = { id: 1001, name: "CI", head_sha: "h1", status: "completed", conclusion: "success", output: { title: null, summary: null }, html_url: "https://github.com/x", app: { slug: "github-actions" } };
    const ctx = firstSync(
      {
        [firstList("acme/app")]: [pull],
        "GET /repos/acme/app/pulls/3": { ...pull, draft: false, merged: false, head: { ref: "feat", sha: "h1", repo: { id: 1 } }, base: { ref: "main", sha: "m1", repo: { id: 1 } } },
        "GET /repos/acme/app/issues/3/comments": [],
        "GET /repos/acme/app/pulls/3/reviews": [],
        "GET /repos/acme/app/pulls/3/comments": [],
        "GET /repos/acme/app/commits/h1/check-runs": [],
        "GET /repos/acme/app/commits/h1": { sha: "h1" },
        "POST /repos/acme/app/check-runs": { id: 55 },
      },
      {
        "POST /repos/acme-gh/app/pulls": { number: 8 },
        "GET /repos/acme-gh/app/commits/h1/check-runs": [run],
        "GET /repos/acme-gh/app/check-runs/1001": run,
      },
    );
    ctx.git.repos.ghost.set("refs/heads/feat", "h1");
    ctx.git.repos.ghost.set("refs/heads/main", "m1");
    await reconcileSync(ctx, owner);
    expect(writes(ctx.ghost).map((c) => c.path)).toContain("/repos/acme/app/check-runs");
  });

  test("commit statuses on open pull request heads are copied", async () => {
    const pull = { ...issue(3, "bob"), pull_request: {} };
    const ctx = firstSync(
      {
        [firstList("acme/app")]: [pull],
        "GET /repos/acme/app/pulls/3": { ...pull, draft: false, merged: false, head: { ref: "feat", sha: "h1", repo: { id: 1 } }, base: { ref: "main", sha: "m1", repo: { id: 1 } } },
        "GET /repos/acme/app/issues/3/comments": [],
        "GET /repos/acme/app/pulls/3/reviews": [],
        "GET /repos/acme/app/pulls/3/comments": [],
        "GET /repos/acme/app/commits/h1/check-runs": [],
        "GET /repos/acme/app/commits/h1/statuses": [],
        "GET /repos/acme/app/commits/h1": { sha: "h1" },
        "POST /repos/acme/app/statuses/h1": {},
      },
      {
        "POST /repos/acme-gh/app/pulls": { number: 8 },
        "GET /repos/acme-gh/app/commits/h1/check-runs": [],
        "GET /repos/acme-gh/app/commits/h1/statuses": [{ context: "Vercel", state: "success", description: "Preview ready", target_url: "https://app-git-feat.vercel.app", creator: { login: "vercel[bot]" } }],
      },
    );
    ctx.git.repos.ghost.set("refs/heads/feat", "h1");
    ctx.git.repos.ghost.set("refs/heads/main", "m1");
    await reconcileSync(ctx, owner);
    expect(writes(ctx.ghost).filter((c) => c.path === "/repos/acme/app/statuses/h1").map((c) => c.body)).toEqual([{ context: "Vercel", state: "success", description: "Preview ready", target_url: "https://app-git-feat.vercel.app" }]);
  });

  test("a first run without backfill copies nothing, records where every ref stands, and goes active", async () => {
    const createdAt = new Date("2026-11-20T00:00:00Z");
    const ctx = testContext({ sync: { lastReconciledAt: null, status: "backfilling", backfill: false, createdAt }, git: fakeGit({ ghost: { "refs/heads/main": "a" }, github: { "refs/heads/main": "b" } }) });
    await reconcileSync(ctx, owner);
    expect(ctx.git.pushes).toEqual([]);
    expect([...ctx.ghost.calls, ...ctx.github.calls]).toEqual([]);
    expect(await ctx.store.getSync(ctx.sync.id)).toMatchObject({ status: "active", lastReconciledAt: createdAt, refsAtSetup: { ghost: { "refs/heads/main": "a" }, github: { "refs/heads/main": "b" } } });
    expect(ctx.store.activity.map((a) => a.summary)).toEqual(["Sync started without history: only what happens from now on is copied"]);
  });

  test("each pass copies the statuses on each side's default branch head, which no pull request brings back", async () => {
    const ctx = firstSync(
      { "GET /repos/acme/app/commits/m1": { sha: "m1" }, "GET /repos/acme/app/commits/m1/statuses": [], "POST /repos/acme/app/statuses/m1": {} },
      { "GET /repos/acme-gh/app/commits/m1/statuses": [{ context: "Ghost - api", state: "success", description: null, target_url: null, creator: { login: "railway-app[bot]" } }] },
    );
    ctx.git.repos.ghost.set("refs/heads/main", "m1");
    ctx.git.repos.github.set("refs/heads/main", "m1");
    await reconcileSync(ctx, owner);
    expect(writes(ctx.ghost).filter((c) => c.path === "/repos/acme/app/statuses/m1").map((c) => c.body)).toEqual([{ context: "Ghost - api", state: "success" }]);
  });

  test("later runs list only what changed since a little before the last one began", async () => {
    const last = new Date("2026-11-01T00:05:00.000Z");
    const since = "2026-11-01T00:00:00.000Z";
    const ctx = testContext({
      git: fakeGit(),
      sync: { lastReconciledAt: last },
      ghost: { [`GET /repos/acme/app/issues?state=all&since=${since}`]: [] },
      github: { [`GET /repos/acme-gh/app/issues?state=all&since=${since}`]: [] },
    });
    await reconcileSync(ctx, owner);
    expect((await ctx.store.getSync(ctx.sync.id))?.status).toBe("active");
    expect(ctx.store.activity).toEqual([]);
  });

  test("a refused token disconnects the sync, naming the side", async () => {
    const ctx = firstSync({}, {
      [firstList("acme-gh/app")]: () => {
        throw new RestError(401, { message: "Bad credentials" });
      },
    });
    await reconcileSync(ctx, owner);
    expect(await ctx.store.getSync(ctx.sync.id)).toMatchObject({ status: "disconnected", disconnectReason: expect.stringContaining("GitHub") });
  });

  test("a server error on one item is logged and the rest carry on", async () => {
    const ctx = firstSync({
      "GET /repos/acme/app/issues/12": () => {
        throw new RestError(502, { message: "Bad Gateway" });
      },
    });
    await reconcileSync(ctx, owner);
    expect(ctx.store.activity.some((a) => a.error?.includes("502"))).toBe(true);
    expect(writes(ctx.github).filter((c) => c.method === "POST")).toHaveLength(1);
    expect((await ctx.store.getSync(ctx.sync.id))?.status).toBe("active");
  });
});

describe("reconcile failures", () => {
  test("a repository gone from a side disconnects the sync, naming that side", async () => {
    const ctx = firstSync({ [firstList("acme/app")]: () => {
      throw new RestError(404, { message: "Not Found" });
    } });
    await reconcileSync(ctx, owner);
    expect(await ctx.store.getSync(ctx.sync.id)).toMatchObject({ status: "disconnected", disconnectReason: expect.stringContaining("Ghost") });
  });

  test("a token refused while copying one item stops the run instead of failing every item", async () => {
    const ctx = firstSync({ "GET /repos/acme/app/issues/12": () => {
      throw new RestError(401, { message: "Bad credentials" });
    } });
    await reconcileSync(ctx, owner);
    expect(await ctx.store.getSync(ctx.sync.id)).toMatchObject({ status: "disconnected", disconnectReason: expect.stringContaining("Ghost") });
    expect(writes(ctx.github)).toEqual([]);
  });

  test("an unexpected failure marks the sync errored and keeps its last good run", async () => {
    const last = new Date("2026-11-01T00:00:00.000Z");
    const git = fakeGit();
    git.fetchBoth = async () => {
      throw new Error("git fetch timed out");
    };
    const ctx = testContext({ git, sync: { lastReconciledAt: last } });
    await reconcileSync(ctx, owner);
    expect(await ctx.store.getSync(ctx.sync.id)).toMatchObject({ status: "error", lastError: "git fetch timed out", lastReconciledAt: last });
    expect(ctx.store.activity).toEqual([expect.objectContaining({ kind: "reconcile", error: "git fetch timed out" })]);
  });

  test("an errored sync that reconciles cleanly is active again", async () => {
    const ctx = firstSync();
    await ctx.store.updateSync(ctx.sync.id, { status: "error", lastError: "earlier" });
    await reconcileSync(ctx, owner);
    expect(await ctx.store.getSync(ctx.sync.id)).toMatchObject({ status: "active", lastError: null });
  });

  test("the next run's window starts from when this run began, not when it ended", async () => {
    const ctx = firstSync({ "GET /repos/acme/app/issues/13": async () => {
      await Bun.sleep(30);
      return issue(13, "bob", { state: "closed" });
    } });
    const before = Date.now();
    await reconcileSync(ctx, owner);
    expect((await ctx.store.getSync(ctx.sync.id))?.lastReconciledAt?.getTime()).toBeLessThan(before + 30);
  });
});

describe("ownerIsAdmin", () => {
  const repo = (admin: boolean) => ({ permissions: { admin } });
  const rest = (answer: unknown) => ({
    request: async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
    paginate: async function* () {},
    graphql: async () => ({}),
  }) as never;
  const sync = { ghostFullName: "acme/app", githubFullName: "acme-gh/app" };

  test("admin on both repositories", async () => {
    expect(await ownerIsAdmin({ ghost: rest(repo(true)), github: rest(repo(true)) }, sync)).toBe(true);
  });

  test("not admin, unlinked, or unable to see a repository counts as lost", async () => {
    expect(await ownerIsAdmin({ ghost: rest(repo(true)), github: rest(repo(false)) }, sync)).toBe(false);
    expect(await ownerIsAdmin({ ghost: rest(repo(true)), github: null }, sync)).toBe(false);
    expect(await ownerIsAdmin({ ghost: rest(new RestError(404, { message: "Not Found" })), github: rest(repo(true)) }, sync)).toBe(false);
  });

  test("a server error is not mistaken for lost access", async () => {
    await expect(ownerIsAdmin({ ghost: rest(new RestError(502, null)), github: rest(repo(true)) }, sync)).rejects.toMatchObject({ status: 502 });
  });
});

describe("startReconcileTimer", () => {
  test("a tick queues a reconcile for each live sync and prunes", async () => {
    const syncs = [syncRow({ id: "a" }), syncRow({ id: "b", status: "paused" }), syncRow({ id: "c", status: "disconnected" }), syncRow({ id: "d", status: "backfilling" }), syncRow({ id: "e", status: "error" })];
    const store = fakeStore({ syncs });
    let pruned = false;
    store.prune = async () => {
      pruned = true;
    };
    const queued: { syncId: string; action: SyncAction }[] = [];
    const timer = startReconcileTimer({
      store,
      intervalSeconds: 3600,
      queue: {
        push: async (syncId, action) => {
          queued.push({ syncId, action });
        },
      },
    });
    await timer.tick();
    timer.stop();
    expect(queued.map((q) => q.syncId).sort()).toEqual(["a", "d", "e"]);
    expect(queued.every((q) => q.action.kind === "reconcile")).toBe(true);
    expect(pruned).toBe(true);
  });
});
