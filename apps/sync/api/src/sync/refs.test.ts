import { describe, expect, test } from "bun:test";
import { fakeGit } from "../lib/fake-git.ts";
import { writes } from "../lib/fake-rest.ts";
import { RestError } from "../rest.ts";
import { testContext } from "../lib/test-context.ts";
import { decideRef, type RefAction, type RefState, syncRefs } from "./refs.ts";

const s = (base: string | null, ghost: string | null, github: string | null, ghostHasGithub = false, githubHasGhost = false): RefState => ({ base, ghost, github, ghostHasGithub, githubHasGhost });

describe("decideRef", () => {
  const cases: [string, RefState, RefAction][] = [
    ["unchanged", s("a", "a", "a", true, true), { kind: "none" }],
    ["ghost moved", s("a", "b", "a", true, false), { kind: "copy", to: "github", sha: "b", expected: "a" }],
    ["ghost force-pushed", s("a", "x", "a"), { kind: "copy", to: "github", sha: "x", expected: "a" }],
    ["ghost deleted", s("a", null, "a"), { kind: "copy", to: "github", sha: null, expected: "a" }],
    ["github moved", s("a", "a", "b", false, true), { kind: "copy", to: "ghost", sha: "b", expected: "a" }],
    ["github force-pushed", s("a", "a", "x"), { kind: "copy", to: "ghost", sha: "x", expected: "a" }],
    ["github deleted", s("a", "a", null), { kind: "copy", to: "ghost", sha: null, expected: "a" }],
    ["both to same", s("a", "b", "b", true, true), { kind: "record", sha: "b" }],
    ["both moved, github ahead", s("a", "b", "c", false, true), { kind: "copy", to: "ghost", sha: "c", expected: "b" }],
    ["both moved, ghost ahead", s("a", "c", "b", true, false), { kind: "copy", to: "github", sha: "c", expected: "b" }],
    ["both moved apart", s("a", "b", "c"), { kind: "diverged" }],
    ["ghost deleted, github moved", s("a", null, "c"), { kind: "diverged" }],
    ["github deleted, ghost moved", s("a", "c", null), { kind: "diverged" }],
    ["both deleted", s("a", null, null), { kind: "record", sha: null }],
    ["new on ghost", s(null, "b", null), { kind: "copy", to: "github", sha: "b", expected: null }],
    ["new on github", s(null, null, "b"), { kind: "copy", to: "ghost", sha: "b", expected: null }],
    ["new on both, same", s(null, "b", "b", true, true), { kind: "record", sha: "b" }],
    ["new on both, ghost ahead", s(null, "c", "b", true, false), { kind: "copy", to: "github", sha: "c", expected: "b" }],
    ["new on both, github ahead", s(null, "b", "c", false, true), { kind: "copy", to: "ghost", sha: "c", expected: "b" }],
    ["new on both, apart", s(null, "c", "b"), { kind: "diverged" }],
  ];
  test.each(cases)("%s", (_, state, action) => {
    expect(decideRef(state)).toEqual(action);
  });

  test("never a destructive copy unless the target still equals the base", () => {
    const shas = [null, "a", "b", "c"];
    for (const base of shas) for (const ghost of shas) for (const github of shas) for (const gh of [false, true]) for (const hg of [false, true]) {
      const action = decideRef(s(base, ghost, github, gh, hg));
      if (action.kind !== "copy") continue;
      const target = action.to === "ghost" ? ghost : github;
      const source = action.to === "ghost" ? github : ghost;
      const fastForward = target !== null && source !== null && (action.to === "ghost" ? hg : gh);
      expect(action.expected).toBe(target);
      expect(target === base || fastForward || (target === null && base === null)).toBe(true);
    }
  });
});

describe("syncRefs", () => {
  const main = "refs/heads/main";
  const noPulls = { "GET /repos/acme/app/pulls?state=open&head=acme:main": [] };

  describe("a sync started without backfill", () => {
    const setup = { ghost: { [main]: "a", "refs/heads/old": "o1" }, github: { [main]: "a", "refs/heads/old": "o2", "refs/heads/gh-only": "g" } };

    test("leaves refs that have not moved since it started", async () => {
      const ctx = testContext({ sync: { backfill: false, refsAtSetup: setup }, git: fakeGit({ ghost: setup.ghost, github: setup.github }) });
      await syncRefs(ctx);
      expect(ctx.git.pushes).toEqual([]);
      expect(ctx.store.refs).toEqual([]);
    });

    test("syncs a ref someone moved since, taking a ref both sides agreed on at setup as its base", async () => {
      const ctx = testContext({ sync: { backfill: false, refsAtSetup: setup }, git: fakeGit({ ghost: { ...setup.ghost, [main]: "b" }, github: setup.github }) });
      ctx.git.ancestors.add("a>b");
      await syncRefs(ctx);
      expect(ctx.git.pushes).toEqual([{ side: "github", ref: main, sha: "b", expected: "a" }]);
    });

    test("a ref deleted on one side since is deleted on the other, as with a recorded base", async () => {
      const { [main]: _, ...rest } = setup.ghost;
      const ctx = testContext({ sync: { backfill: false, refsAtSetup: setup }, git: fakeGit({ ghost: rest, github: setup.github }) });
      await syncRefs(ctx);
      expect(ctx.git.pushes).toEqual([{ side: "github", ref: main, sha: null, expected: "a" }]);
    });

    test("once a deletion has synced, a branch recreated at its setup commit is created again, not taken for the untouched original", async () => {
      const { [main]: _, ...rest } = setup.ghost;
      const ctx = testContext({ sync: { backfill: false, refsAtSetup: setup }, git: fakeGit({ ghost: rest, github: setup.github }) });
      await syncRefs(ctx);
      ctx.git.repos.ghost.set(main, "a");
      await syncRefs(ctx);
      expect(ctx.git.pushes).toEqual([
        { side: "github", ref: main, sha: null, expected: "a" },
        { side: "github", ref: main, sha: "a", expected: null },
      ]);
      expect((await ctx.store.getSync(ctx.sync.id))?.refsAtSetup).toEqual({ ghost: { "refs/heads/old": "o1" }, github: { "refs/heads/old": "o2", "refs/heads/gh-only": "g" } });
    });

    test("a ref a webhook names is synced even if it has not moved", async () => {
      const ctx = testContext({ sync: { backfill: false, refsAtSetup: setup }, git: fakeGit({ ghost: setup.ghost, github: setup.github }) });
      await syncRefs(ctx, ["refs/heads/gh-only"]);
      expect(ctx.git.pushes).toEqual([{ side: "ghost", ref: "refs/heads/gh-only", sha: "g", expected: null }]);
    });
  });

  test("a branch new on GitHub is created on Ghost and its base recorded", async () => {
    const ctx = testContext({ git: fakeGit({ github: { [main]: "b" } }) });
    await syncRefs(ctx);
    expect(ctx.git.pushes).toEqual([{ side: "ghost", ref: main, sha: "b", expected: null }]);
    expect(await ctx.store.getRef(ctx.sync.id, main)).toMatchObject({ baseSha: "b", diverged: null });
  });

  test("statuses reported on a head before it reached the other side are copied once it is pushed there", async () => {
    const ctx = testContext({
      git: fakeGit({ github: { [main]: "b" } }),
      github: { "GET /repos/acme-gh/app/commits/b/statuses": [{ context: "Vercel", state: "success", description: null, target_url: null, creator: { login: "vercel[bot]" } }] },
      ghost: { "GET /repos/acme/app/commits/b": { sha: "b" }, "GET /repos/acme/app/commits/b/statuses": [], "POST /repos/acme/app/statuses/b": {} },
    });
    await syncRefs(ctx);
    expect(writes(ctx.ghost)).toEqual([{ method: "POST", path: "/repos/acme/app/statuses/b", body: { context: "Vercel", state: "success" } }]);
  });

  test("a branch moved on Ghost goes to GitHub with the base as lease", async () => {
    const ctx = testContext({ git: fakeGit({ ghost: { [main]: "b" }, github: { [main]: "a" } }) });
    ctx.git.ancestors.add("a>b");
    await ctx.store.setBase(ctx.sync.id, main, "a");
    await syncRefs(ctx);
    expect(ctx.git.pushes).toEqual([{ side: "github", ref: main, sha: "b", expected: "a" }]);
    expect((await ctx.store.getRef(ctx.sync.id, main))?.baseSha).toBe("b");
  });

  test("a ref deleted on one side since the last sync is deleted on the other", async () => {
    const ctx = testContext({ git: fakeGit({ github: { "refs/heads/old": "a" } }) });
    await ctx.store.setBase(ctx.sync.id, "refs/heads/old", "a");
    await syncRefs(ctx);
    expect(ctx.git.pushes).toEqual([{ side: "github", ref: "refs/heads/old", sha: null, expected: "a" }]);
    expect(await ctx.store.getRef(ctx.sync.id, "refs/heads/old")).toBeNull();
  });

  test("a diverged branch touches neither side, is flagged, logged and commented on once", async () => {
    const ctx = testContext({
      git: fakeGit({ ghost: { "refs/heads/feat": "b" }, github: { "refs/heads/feat": "c" } }),
      ghost: {
        "GET /repos/acme/app/pulls?state=open&head=acme:feat": [{ number: 3 }],
        "POST /repos/acme/app/issues/3/comments": { id: 1 },
      },
      github: { "POST /repos/acme-gh/app/issues/8/comments": { id: 2 } },
    });
    await ctx.store.setBase(ctx.sync.id, "refs/heads/feat", "a");
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "pull", ghostId: "3", ghostRestId: null, githubId: "8" });
    await syncRefs(ctx);
    await syncRefs(ctx);
    expect(ctx.git.pushes).toEqual([]);
    expect(await ctx.store.getRef(ctx.sync.id, "refs/heads/feat")).toMatchObject({ baseSha: "a", diverged: { ghost: "b", github: "c" } });
    expect(ctx.store.activity.filter((a) => a.kind === "refs")).toHaveLength(1);
    const comments = [...writes(ctx.ghost), ...writes(ctx.github)];
    expect(comments.map((c) => c.path)).toEqual(["/repos/acme/app/issues/3/comments", "/repos/acme-gh/app/issues/8/comments"]);
    expect(JSON.stringify(comments[0]?.body)).toMatch(/diverged/i);
  });

  test("a notice that fails is retried on the next run, and the other refs still sync", async () => {
    let lookups = 0;
    const ctx = testContext({
      git: fakeGit({ ghost: { "refs/heads/feat": "b", "refs/heads/dev": "d" }, github: { "refs/heads/feat": "c" } }),
      ghost: {
        "GET /repos/acme/app/pulls?state=open&head=acme:feat": () => {
          if (++lookups === 1) throw new RestError(502, { message: "Bad Gateway" });
          return [{ number: 3 }];
        },
        "POST /repos/acme/app/issues/3/comments": { id: 1 },
      },
      github: { "POST /repos/acme-gh/app/issues/8/comments": { id: 2 } },
    });
    await ctx.store.setBase(ctx.sync.id, "refs/heads/feat", "a");
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "pull", ghostId: "3", ghostRestId: null, githubId: "8" });
    await syncRefs(ctx);
    expect(ctx.git.repos.github.get("refs/heads/dev")).toBe("d");
    expect(ctx.store.activity.filter((a) => a.kind === "comment")).toEqual([expect.objectContaining({ error: "502 Bad Gateway" })]);
    expect([...writes(ctx.ghost), ...writes(ctx.github)]).toEqual([]);
    await syncRefs(ctx);
    await syncRefs(ctx);
    expect([...writes(ctx.ghost), ...writes(ctx.github)]).toHaveLength(2);
    expect(ctx.store.activity.filter((a) => a.kind === "refs" && a.error !== null)).toHaveLength(1);
    expect(ctx.store.activity).toContainEqual(expect.objectContaining({ kind: "refs", direction: "github", summary: expect.stringMatching(/^(Created|Moved) dev at d/), error: null }));
  });

  test("a notice that failed halfway posts only the missing comment on the retry", async () => {
    let githubPosts = 0;
    const ctx = testContext({
      git: fakeGit({ ghost: { "refs/heads/feat": "b" }, github: { "refs/heads/feat": "c" } }),
      ghost: { "GET /repos/acme/app/pulls?state=open&head=acme:feat": [{ number: 3 }], "POST /repos/acme/app/issues/3/comments": { id: 1 } },
      github: {
        "POST /repos/acme-gh/app/issues/8/comments": () => {
          if (++githubPosts === 1) throw new RestError(422, { message: "Validation Failed" });
          return { id: 2 };
        },
      },
    });
    await ctx.store.setBase(ctx.sync.id, "refs/heads/feat", "a");
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "pull", ghostId: "3", ghostRestId: null, githubId: "8" });
    await syncRefs(ctx);
    await syncRefs(ctx);
    await syncRefs(ctx);
    expect(writes(ctx.ghost)).toHaveLength(1);
    expect(githubPosts).toBe(2);
    expect((await ctx.store.getRef(ctx.sync.id, "refs/heads/feat"))?.diverged).toMatchObject({ notified: true, posted: ["ghost#3", "github#8"] });
  });

  test("the flag clears once a person makes the sides agree", async () => {
    const ctx = testContext({ git: fakeGit({ ghost: { [main]: "b" }, github: { [main]: "c" } }), ghost: noPulls });
    await ctx.store.setBase(ctx.sync.id, main, "a");
    await syncRefs(ctx);
    ctx.git.repos.github.set(main, "m");
    ctx.git.ancestors.add("b>m");
    await syncRefs(ctx);
    expect(ctx.git.pushes).toEqual([{ side: "ghost", ref: main, sha: "m", expected: "b" }]);
    expect(await ctx.store.getRef(ctx.sync.id, main)).toMatchObject({ baseSha: "m", diverged: null });
  });

  test("a person pushing during sync keeps their commit: the lease fails and the comparison re-runs", async () => {
    const git = fakeGit({ ghost: { [main]: "b" }, github: { [main]: "a" } });
    git.ancestors.add("a>b");
    const realPush = git.pushRef;
    let raced = false;
    git.pushRef = async (dir, remote, ref, sha, expected) => {
      if (!raced) {
        raced = true;
        git.repos.github.set(main, "theirs");
      }
      return realPush(dir, remote, ref, sha, expected);
    };
    const ctx = testContext({ git, ghost: noPulls });
    await ctx.store.setBase(ctx.sync.id, main, "a");
    await syncRefs(ctx);
    expect(git.repos.github.get(main)).toBe("theirs");
    expect(git.pushes).toHaveLength(1);
    expect((await ctx.store.getRef(ctx.sync.id, main))?.diverged).toMatchObject({ ghost: "b", github: "theirs" });
  });

  test("a rejected push flags that ref and the rest still sync", async () => {
    const git = fakeGit({ ghost: { [main]: "b", "refs/heads/dev": "d" } });
    git.rejects.set(`github ${main}`, "protected branch hook declined");
    const ctx = testContext({ git, ghost: noPulls });
    await syncRefs(ctx);
    expect((await ctx.store.getRef(ctx.sync.id, main))?.diverged?.reason).toMatch(/^rejected: .*protected branch/);
    expect(git.repos.github.get("refs/heads/dev")).toBe("d");
  });

  test("ghost-pr/* branches are left to pull requests", async () => {
    const ctx = testContext({ git: fakeGit({ github: { "refs/heads/ghost-pr/3": "x" } }) });
    await syncRefs(ctx);
    expect(ctx.git.pushes).toEqual([]);
  });

  test("only the named refs when given", async () => {
    const ctx = testContext({ git: fakeGit({ ghost: { [main]: "b", "refs/heads/dev": "d" } }) });
    await syncRefs(ctx, [main]);
    expect(ctx.git.pushes.map((p) => p.ref)).toEqual([main]);
  });

  test("tags follow the same rules", async () => {
    const ctx = testContext({ git: fakeGit({ ghost: { "refs/tags/v1": "a" } }) });
    await syncRefs(ctx);
    expect(ctx.git.pushes).toEqual([{ side: "github", ref: "refs/tags/v1", sha: "a", expected: null }]);
  });

  test("a second run right after the first makes no pushes", async () => {
    const ctx = testContext({ git: fakeGit({ ghost: { [main]: "b" }, github: { "refs/heads/dev": "d" } }) });
    await syncRefs(ctx);
    const pushed = ctx.git.pushes.length;
    await syncRefs(ctx);
    expect(ctx.git.pushes).toHaveLength(pushed);
  });
});
