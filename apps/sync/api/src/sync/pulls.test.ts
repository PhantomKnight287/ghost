import { describe, expect, test } from "bun:test";
import { withMarker } from "../format.ts";
import { fakeGit } from "../lib/fake-git.ts";
import { writes } from "../lib/fake-rest.ts";
import { testContext } from "../lib/test-context.ts";
import { RestError } from "../rest.ts";
import { syncPull } from "./pulls.ts";

const feat = "refs/heads/feat";
const main = "refs/heads/main";
const ghostPull = (overrides: Record<string, unknown> = {}) => ({
  number: 3,
  node_id: "PR_g3",
  title: "Add sync",
  body: "Does things",
  state: "open",
  draft: false,
  merged: false,
  user: { login: "bob" },
  labels: [],
  head: { ref: "feat", sha: "h1", repo: { id: 1 } },
  base: { ref: "main", sha: "m1", repo: { id: 1 } },
  ...overrides,
});
/** GitHub #8, the copy of Ghost #3 as both sides last agreed on it. */
const githubPull = (overrides: Record<string, unknown> = {}) => ({
  number: 8,
  node_id: "PR_gh8",
  title: "Add sync",
  body: withMarker("Does things", "ghost", "bob"),
  state: "open",
  draft: false,
  merged: false,
  user: { login: "ghost-sync[bot]" },
  labels: [],
  head: { ref: "feat", sha: "h1", repo: { id: 2 } },
  base: { ref: "main", sha: "m1", repo: { id: 2 } },
  ...overrides,
});
const agreed = { title: "Add sync", body: "Does things", state: "open", base: "main", draft: false, labels: [] as string[] };
/** Ghost has `feat`; both sides agree on `main`. */
const repos = () => {
  const git = fakeGit({ ghost: { [feat]: "h1", [main]: "m1" }, github: { [main]: "m1" } });
  return git;
};
/** Linked as Ghost #3 ↔ GitHub #8, with both branches already agreed on both sides. */
const linked = async (ctx: ReturnType<typeof testContext>, synced: Partial<typeof agreed> = {}) => {
  ctx.git.repos.github.set(feat, "h1");
  await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "pull", ghostId: "3", ghostRestId: null, githubId: "8", synced: { ...agreed, ...synced } });
  await ctx.store.setBase(ctx.sync.id, main, "m1");
  await ctx.store.setBase(ctx.sync.id, feat, "h1");
};

describe("syncPull, unlinked", () => {
  test("refs first, then the pull request, attributed, and linked", async () => {
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull() },
      github: { "POST /repos/acme-gh/app/pulls": { number: 8 } },
    });
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await syncPull(ctx, "ghost", 3);
    expect(ctx.git.pushes).toEqual([{ side: "github", ref: feat, sha: "h1", expected: null }]);
    expect(writes(ctx.github)).toEqual([
      { method: "POST", path: "/repos/acme-gh/app/pulls", body: { title: "Add sync", body: withMarker("Does things", "ghost", "bob"), head: "feat", base: "main", draft: false } },
    ]);
    expect(await ctx.store.findLink(ctx.sync.id, "pull", "ghost", "3")).toMatchObject({ githubId: "8" });
  });

  test("a pull request with a twin on the same branches is paired, not copied, and its branches are left alone", async () => {
    const twin = githubPull({ user: { login: "alice" }, body: "Ghost twin: #3", state: "closed", merged: true, head: { ref: "feat", sha: "old", repo: { id: 2 } } });
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull() },
      github: { "GET /repos/acme-gh/app/pulls?state=all&head=acme-gh:feat": [githubPull({ number: 7, base: { ref: "dev", sha: "d1", repo: { id: 2 } } }), githubPull({ number: 9 }), twin], "GET /repos/acme-gh/app/pulls/8": twin },
    });
    await syncPull(ctx, "ghost", 3);
    expect(ctx.git.pushes).toEqual([]);
    expect(writes(ctx.github)).toEqual([]);
    expect(await ctx.store.findLink(ctx.sync.id, "pull", "ghost", "3")).toMatchObject({ githubId: "8", pairedAt: expect.any(Date) });
    expect(ctx.store.activity.map((a) => a.summary)).toEqual(["Paired Ghost pull request #3 with its twin, GitHub pull request #8"]);
  });

  test("the pair agrees on the twin pull request as it is now, and one moved to another base since the list is no twin", async () => {
    const twin = githubPull({ user: { login: "alice" }, body: "stale" });
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull() },
      github: { "GET /repos/acme-gh/app/pulls?state=all&head=acme-gh:feat": [twin], "GET /repos/acme-gh/app/pulls/8": { ...twin, body: "current" } },
    });
    await syncPull(ctx, "ghost", 3);
    expect((await ctx.store.findLink(ctx.sync.id, "pull", "ghost", "3"))?.synced).toMatchObject({ body: { differ: { ghost: "Does things", github: "current" } } });

    const moved = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull() },
      github: { "GET /repos/acme-gh/app/pulls?state=all&head=acme-gh:feat": [twin], "GET /repos/acme-gh/app/pulls/8": { ...twin, base: { ref: "dev", sha: "d1", repo: { id: 2 } } }, "POST /repos/acme-gh/app/pulls": { number: 10 } },
    });
    await moved.store.setBase(moved.sync.id, main, "m1");
    await syncPull(moved, "ghost", 3);
    expect(await moved.store.findLink(moved.sync.id, "pull", "ghost", "3")).toMatchObject({ githubId: "10", pairedAt: null });
  });

  test("a twin merged before pairing does not close its open twin on a later pass", async () => {
    const merged = githubPull({ user: { login: "alice" }, body: "Ghost twin: #3", state: "closed", merged: true });
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull() },
      github: { "GET /repos/acme-gh/app/pulls?state=all&head=acme-gh:feat": [merged], "GET /repos/acme-gh/app/pulls/8": merged },
    });
    ctx.git.repos.github.set(feat, "h1");
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await ctx.store.setBase(ctx.sync.id, feat, "h1");
    await syncPull(ctx, "ghost", 3);
    await syncPull(ctx, "github", 8);
    expect(writes(ctx.ghost)).toEqual([]);
    expect(writes(ctx.github)).toEqual([]);
  });

  test("GitHub to Ghost the same way", async () => {
    const ctx = testContext({
      git: fakeGit({ github: { [feat]: "h1", [main]: "m1" }, ghost: { [main]: "m1" } }),
      github: { "GET /repos/acme-gh/app/pulls/8": { ...ghostPull({ number: 8, user: { login: "alice" } }) } },
      ghost: { "POST /repos/acme/app/pulls": { number: 3 } },
    });
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await syncPull(ctx, "github", 8);
    expect(writes(ctx.ghost)[0]).toMatchObject({ path: "/repos/acme/app/pulls", body: { head: "feat", base: "main", body: withMarker("Does things", "github", "alice") } });
  });

  test("labels follow once it exists", async () => {
    const bug = { name: "bug", color: "d73a4a", description: null };
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ labels: [bug] }) },
      github: { "POST /repos/acme-gh/app/pulls": { number: 8 }, "GET /repos/acme-gh/app/labels/bug": bug, "PATCH /repos/acme-gh/app/issues/8": {} },
    });
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)[1]).toEqual({ method: "PATCH", path: "/repos/acme-gh/app/issues/8", body: { labels: ["bug"] } });
  });

  test("a head that could not reach the other side skips the pull request", async () => {
    const git = repos();
    git.rejects.set(`github ${feat}`, "protected");
    const ctx = testContext({ git, ghost: { "GET /repos/acme/app/pulls/3": ghostPull() } });
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)).toEqual([]);
    expect(ctx.store.activity.some((a) => a.kind === "pull" && a.error !== null)).toBe(true);
  });

  test("a host refusal (no commits between) is skipped, not thrown", async () => {
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ state: "closed", merged: true }) },
      github: {
        "POST /repos/acme-gh/app/pulls": () => {
          throw new RestError(422, { message: "No commits between main and feat" });
        },
      },
    });
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await syncPull(ctx, "ghost", 3);
    expect(ctx.store.activity.some((a) => a.kind === "pull" && a.error?.includes("No commits between"))).toBe(true);
    expect(await ctx.store.findLink(ctx.sync.id, "pull", "ghost", "3")).toBeNull();
  });

  test("a closed pull request is created then closed", async () => {
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ state: "closed" }) },
      github: { "POST /repos/acme-gh/app/pulls": { number: 8 }, "GET /repos/acme-gh/app/pulls/8": githubPull(), "PATCH /repos/acme-gh/app/pulls/8": {} },
    });
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github).at(-1)).toEqual({ method: "PATCH", path: "/repos/acme-gh/app/pulls/8", body: expect.objectContaining({ state: "closed" }) });
  });

  test("written by our bot: left alone", async () => {
    const ctx = testContext({ git: repos(), ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ user: { login: "ghost-sync[bot]" } }) } });
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)).toEqual([]);
    expect(ctx.git.pushes).toEqual([]);
  });
});

describe("forks", () => {
  test("a Ghost fork's head goes to ghost-pr/<n> on GitHub and heads the copy", async () => {
    const git = repos();
    git.pullHeads.set(3, "fh");
    const ctx = testContext({
      git,
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ head: { ref: "feat", sha: "fh", repo: { id: 99 } } }) },
      github: { "POST /repos/acme-gh/app/pulls": { number: 8 } },
    });
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await syncPull(ctx, "ghost", 3);
    expect(git.pushes).toContainEqual({ side: "github", ref: "refs/heads/ghost-pr/3", sha: "fh", expected: null });
    expect(git.pushes.some((p) => p.ref === feat)).toBe(false);
    expect(writes(ctx.github)[0]?.body).toMatchObject({ head: "ghost-pr/3", base: "main" });
  });

  test("ghost-pr/<n> follows the fork exactly, force-pushes included", async () => {
    const git = repos();
    git.repos.github.set("refs/heads/ghost-pr/3", "old");
    git.pullHeads.set(3, "rewritten");
    const ctx = testContext({
      git,
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ head: { ref: "feat", sha: "rewritten", repo: { id: 99 } } }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull(), "PATCH /repos/acme-gh/app/pulls/8": {} },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(git.pushes).toContainEqual({ side: "github", ref: "refs/heads/ghost-pr/3", sha: "rewritten", expected: "old" });
    expect(ctx.store.activity.map((a) => a.summary)).toContain("Moved ghost-pr/3 to rewritt, the head of Ghost fork pull request #3");
  });

  test("ghost-pr/<n> is deleted when the pull request closes", async () => {
    const git = repos();
    git.repos.github.set("refs/heads/ghost-pr/3", "fh");
    git.pullHeads.set(3, "fh");
    const ctx = testContext({
      git,
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ state: "closed", head: { ref: "feat", sha: "fh", repo: { id: 99 } } }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull(), "PATCH /repos/acme-gh/app/pulls/8": {} },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(git.pushes).toContainEqual({ side: "github", ref: "refs/heads/ghost-pr/3", sha: null, expected: "fh" });
    expect(ctx.store.activity.map((a) => a.summary)).toContain("Deleted ghost-pr/3, as Ghost pull request #3 closed");
  });

  test("a GitHub fork pull request is never synced", async () => {
    const ctx = testContext({
      git: repos(),
      github: { "GET /repos/acme-gh/app/pulls/8": ghostPull({ number: 8, head: { ref: "feat", sha: "x", repo: { id: 77 } }, base: { ref: "main", sha: "m1", repo: { id: 4242 } } }) },
    });
    await syncPull(ctx, "github", 8);
    expect(ctx.ghost.calls).toEqual([]);
    expect(ctx.git.pushes).toEqual([]);
    expect(ctx.store.activity).toEqual([expect.objectContaining({ kind: "pull", summary: expect.stringMatching(/fork/i) })]);
  });

  test("a GitHub pull request whose head repository was deleted counts as a fork", async () => {
    const ctx = testContext({ git: repos(), github: { "GET /repos/acme-gh/app/pulls/8": ghostPull({ number: 8, head: { ref: "feat", sha: "x", repo: null } }) } });
    await syncPull(ctx, "github", 8);
    expect(ctx.ghost.calls).toEqual([]);
  });
});

describe("syncPull, linked", () => {
  test("title, body and state follow", async () => {
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ title: "Renamed" }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull(), "PATCH /repos/acme-gh/app/pulls/8": {} },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)).toEqual([{ method: "PATCH", path: "/repos/acme-gh/app/pulls/8", body: { title: "Renamed" } }]);
    expect(ctx.store.activity.map((a) => a.summary)).toEqual(['Retitled GitHub pull request #8 to "Renamed"']);
  });

  test("a close is copied with the body attributed, and logged", async () => {
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ state: "closed", body: "Reworded" }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull(), "PATCH /repos/acme-gh/app/pulls/8": {} },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)).toEqual([{ method: "PATCH", path: "/repos/acme-gh/app/pulls/8", body: { body: withMarker("Reworded", "ghost", "bob"), state: "closed" } }]);
    expect(ctx.store.activity.map((a) => a.summary)).toEqual(["Edited the description of GitHub pull request #8", "Closed GitHub pull request #8"]);
  });

  test("a change made only on the copy is left for the copy's own pass", async () => {
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull() },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull({ state: "closed" }) },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)).toEqual([]);
  });

  test("ready for review and back to draft go through GraphQL", async () => {
    const ready = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ draft: false }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull({ draft: true }), "PATCH /repos/acme-gh/app/pulls/8": {}, "GRAPHQL markPullRequestReadyForReview": {} },
    });
    await linked(ready, { draft: true });
    await syncPull(ready, "ghost", 3);
    const markCall = ready.github.calls.find((c) => c.method === "GRAPHQL");
    expect(markCall?.path).toBe("markPullRequestReadyForReview");
    expect(JSON.stringify(markCall?.body)).toContain("PR_gh8");

    const draft = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ draft: true }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull(), "PATCH /repos/acme-gh/app/pulls/8": {}, "GRAPHQL convertPullRequestToDraft": {} },
    });
    await linked(draft);
    await syncPull(draft, "ghost", 3);
    expect(draft.github.calls.find((c) => c.method === "GRAPHQL")?.path).toBe("convertPullRequestToDraft");
    expect(draft.store.activity.map((a) => a.summary)).toEqual(["Marked GitHub pull request #8 as a draft"]);
  });

  test("merged on Ghost and seen as merged on GitHub: nothing more", async () => {
    const git = repos();
    git.repos.ghost.set(main, "m2");
    git.ancestors.add("m1>m2");
    const ctx = testContext({
      git,
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ state: "closed", merged: true }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull({ state: "closed", merged: true }) },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(git.pushes).toContainEqual({ side: "github", ref: main, sha: "m2", expected: "m1" });
    expect(writes(ctx.github)).toEqual([]);
  });

  test("merged on Ghost, still open on GitHub: commented and closed", async () => {
    const git = repos();
    git.repos.ghost.set(main, "m2");
    git.ancestors.add("m1>m2");
    const ctx = testContext({
      git,
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ state: "closed", merged: true }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull(), "POST /repos/acme-gh/app/issues/8/comments": { id: 1 }, "PATCH /repos/acme-gh/app/pulls/8": {} },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)).toEqual([
      { method: "POST", path: "/repos/acme-gh/app/issues/8/comments", body: { body: "Merged on Ghost" } },
      { method: "PATCH", path: "/repos/acme-gh/app/pulls/8", body: expect.objectContaining({ state: "closed" }) },
    ]);
  });

  test("merged while the base diverged: the copy stays open", async () => {
    const git = repos();
    git.repos.ghost.set(main, "m2");
    git.repos.github.set(main, "x");
    const ctx = testContext({
      git,
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ state: "closed", merged: true }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull() },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)).toEqual([]);
    expect((await ctx.store.getRef(ctx.sync.id, main))?.diverged).not.toBeNull();
  });
});

describe("syncPull edge cases", () => {
  test("a create whose answer was lost finds our copy instead of opening a second", async () => {
    const copy = { number: 8, title: "Add sync", body: withMarker("Does things", "ghost", "bob"), user: { login: "ghost-sync[bot]" } };
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull() },
      github: {
        "POST /repos/acme-gh/app/pulls": () => {
          throw new RestError(504, { message: "Gateway Timeout" });
        },
        "GET /repos/acme-gh/app/pulls?state=all&head=acme-gh%3Afeat": [copy],
      },
    });
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await syncPull(ctx, "ghost", 3);
    expect(await ctx.store.findLink(ctx.sync.id, "pull", "ghost", "3")).toMatchObject({ githubId: "8" });
  });

  test("a retargeted pull request moves its copy's base", async () => {
    const ctx = testContext({
      git: fakeGit({ ghost: { [feat]: "h1", [main]: "m1", "refs/heads/next": "n1" }, github: { [main]: "m1", "refs/heads/next": "n1" } }),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ base: { ref: "next", sha: "n1", repo: { id: 1 } } }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull({ base: { ref: "main" } }), "PATCH /repos/acme-gh/app/pulls/8": {} },
    });
    await linked(ctx);
    await ctx.store.setBase(ctx.sync.id, "refs/heads/next", "n1");
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)[0]?.body).toMatchObject({ base: "next" });
  });

  test("labels changed on a linked pull request follow", async () => {
    const bug = { name: "bug", color: "d73a4a", description: null };
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ labels: [bug] }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull({ labels: [] }), "PATCH /repos/acme-gh/app/pulls/8": {}, "GET /repos/acme-gh/app/labels/bug": bug, "PATCH /repos/acme-gh/app/issues/8": {} },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github).at(-1)).toEqual({ method: "PATCH", path: "/repos/acme-gh/app/issues/8", body: { labels: ["bug"] } });
    expect(ctx.store.activity.map((a) => a.summary)).toEqual(["Set the labels of GitHub pull request #8 to bug"]);
  });

  test("merged on one side, closed without merging on the other: left as is", async () => {
    const ctx = testContext({
      git: repos(),
      ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ state: "closed", merged: true }) },
      github: { "GET /repos/acme-gh/app/pulls/8": githubPull({ state: "closed" }) },
    });
    await linked(ctx);
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)).toEqual([]);
  });

  test("a fork head GitHub refuses leaves the pull request uncopied, with the reason logged", async () => {
    const git = repos();
    git.pullHeads.set(3, "fh");
    git.rejects.set("github refs/heads/ghost-pr/3", "protected");
    const ctx = testContext({ git, ghost: { "GET /repos/acme/app/pulls/3": ghostPull({ head: { ref: "feat", sha: "fh", repo: { id: 99 } } }) } });
    await ctx.store.setBase(ctx.sync.id, main, "m1");
    await syncPull(ctx, "ghost", 3);
    expect(writes(ctx.github)).toEqual([]);
    expect(ctx.store.activity.some((a) => a.kind === "pull" && a.error?.includes("protected"))).toBe(true);
  });

  test("a vanished source is skipped and logged", async () => {
    const ctx = testContext({ git: repos() });
    await syncPull(ctx, "ghost", 3);
    expect(ctx.store.activity).toEqual([expect.objectContaining({ kind: "pull", error: expect.stringContaining("404") })]);
  });
});

