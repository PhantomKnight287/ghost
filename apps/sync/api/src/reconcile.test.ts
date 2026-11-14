import { describe, expect, test } from "bun:test";
import { withMarker } from "./format.ts";
import { fakeGit } from "./lib/fake-git.ts";
import { type Routes, writes } from "./lib/fake-rest.ts";
import { fakeStore } from "./lib/fake-store.ts";
import { syncRow, testContext } from "./lib/test-context.ts";
import { reconcileSync, startReconcileTimer } from "./reconcile.ts";
import { RestError } from "./rest.ts";
import type { SyncRow } from "./store.ts";
import type { SyncContext } from "./sync/context.ts";

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

  test("later runs list only what changed since the last one", async () => {
    const since = new Date("2026-11-01T00:00:00.000Z");
    const ctx = testContext({
      git: fakeGit(),
      sync: { lastReconciledAt: since },
      ghost: { [`GET /repos/acme/app/issues?state=all&since=${since.toISOString()}`]: [] },
      github: { [`GET /repos/acme-gh/app/issues?state=all&since=${since.toISOString()}`]: [] },
    });
    await reconcileSync(ctx, owner);
    expect((await ctx.store.getSync(ctx.sync.id))?.status).toBe("active");
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

describe("startReconcileTimer", () => {
  test("a tick reconciles live syncs one at a time and prunes", async () => {
    const syncs = [syncRow({ id: "a" }), syncRow({ id: "b", status: "paused" }), syncRow({ id: "c", status: "disconnected" }), syncRow({ id: "d", status: "backfilling" }), syncRow({ id: "e", status: "error" })];
    const store = fakeStore({ syncs });
    let pruned = false;
    store.prune = async () => {
      pruned = true;
    };
    const order: string[] = [];
    let running = 0;
    const timer = startReconcileTimer({
      store,
      intervalSeconds: 3600,
      contextFor: async (sync: SyncRow) => ({ sync }) as SyncContext,
      ownerCanAdminFor: () => owner,
      reconcile: async (ctx) => {
        running++;
        expect(running).toBe(1);
        order.push(ctx.sync.id);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
      },
    });
    await timer.tick();
    timer.stop();
    expect(order.sort()).toEqual(["a", "d", "e"]);
    expect(pruned).toBe(true);
  });

  test("one sync failing does not stop the others", async () => {
    const store = fakeStore({ syncs: [syncRow({ id: "a" }), syncRow({ id: "b" })] });
    const done: string[] = [];
    const timer = startReconcileTimer({
      store,
      intervalSeconds: 3600,
      contextFor: async (sync: SyncRow) => ({ sync }) as SyncContext,
      ownerCanAdminFor: () => owner,
      reconcile: async (ctx) => {
        if (ctx.sync.id === "a") throw new Error("boom");
        done.push(ctx.sync.id);
      },
    });
    await timer.tick();
    timer.stop();
    expect(done).toEqual(["b"]);
    expect(store.activity.some((a) => a.syncId === "a" && a.error?.includes("boom"))).toBe(true);
  });
});
