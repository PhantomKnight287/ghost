import { describe, expect, test } from "bun:test";
import { fakeGit } from "../lib/fake-git.ts";
import { writes } from "../lib/fake-rest.ts";
import { testContext } from "../lib/test-context.ts";
import { runAction } from "./run.ts";

const noReconcile = async () => {
  throw new Error("reconcile not expected");
};

describe("runAction", () => {
  test("refs, deletions and labels reach their sync functions", async () => {
    const ctx = testContext({
      git: fakeGit({ ghost: { "refs/heads/main": "a" } }),
      github: { "DELETE /repos/acme-gh/app/labels/bug": undefined, "DELETE /repos/acme-gh/app/issues/comments/9001": undefined },
    });
    await runAction(ctx, { kind: "refs", refs: ["refs/heads/main"] }, noReconcile);
    expect(ctx.git.pushes).toEqual([{ side: "github", ref: "refs/heads/main", sha: "a", expected: null }]);
    await runAction(ctx, { kind: "label", from: "ghost", name: "bug", deleted: true }, noReconcile);
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "comment", ghostId: "c-uuid", ghostRestId: "301", githubId: "9001" });
    await runAction(ctx, { kind: "comment", from: "ghost", issueNumber: 12, key: "c-uuid", deleted: true }, noReconcile);
    expect(writes(ctx.github).map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /repos/acme-gh/app/labels/bug", "DELETE /repos/acme-gh/app/issues/comments/9001"]);
  });

  test("a commit status reaches the status sync", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/commits/h1/statuses": [{ context: "Vercel", state: "success", description: null, target_url: null, creator: { login: "vercel[bot]" } }] }, ghost: { "GET /repos/acme/app/commits/h1/status": { sha: "h1", state: "pending", total_count: 0 }, "GET /repos/acme/app/commits/h1/statuses": [], "POST /repos/acme/app/statuses/h1": {} } });
    await runAction(ctx, { kind: "status", from: "github", sha: "h1" }, noReconcile);
    expect(writes(ctx.ghost).map((c) => `${c.method} ${c.path}`)).toEqual(["POST /repos/acme/app/statuses/h1"]);
  });

  test("reconcile goes to the reconciler it is given", async () => {
    const ctx = testContext();
    const reconciled: string[] = [];
    await runAction(ctx, { kind: "reconcile" }, async (c) => {
      reconciled.push(c.sync.id);
    });
    expect(reconciled).toEqual([ctx.sync.id]);
  });
});

describe("the sync check on a pushed commit", () => {
  const checks = { "POST /repos/acme/app/check-runs": { id: 77 }, "PATCH /repos/acme/app/check-runs/77": {} };

  test("passes once every ref is synced", async () => {
    const ctx = testContext({ git: fakeGit({ ghost: { "refs/heads/main": "h1" } }), ghost: checks });
    await runAction(ctx, { kind: "sync_check", sha: "h1" }, noReconcile);
    expect(ctx.git.repos.github.get("refs/heads/main")).toBe("h1");
    expect(writes(ctx.ghost).at(-1)?.body).toMatchObject({ conclusion: "success" });
  });

  test("fails naming the ref when the commit's branch could not be synced", async () => {
    const git = fakeGit({ ghost: { "refs/heads/main": "h1" } });
    git.rejects.set("github refs/heads/main", "protected branch");
    const ctx = testContext({ git, ghost: { ...checks, "GET /repos/acme/app/pulls?state=open&head=acme:main": [] } });
    await runAction(ctx, { kind: "sync_check", sha: "h1" }, noReconcile);
    expect(writes(ctx.ghost).at(-1)?.body).toMatchObject({ conclusion: "failure", output: { summary: expect.stringContaining("refs/heads/main: rejected: protected branch") } });
  });

  test("a sync that throws still closes the check, as a failure", async () => {
    const git = fakeGit();
    git.fetchBoth = async () => {
      throw new Error("git fetch timed out");
    };
    const ctx = testContext({ git, ghost: checks });
    await expect(runAction(ctx, { kind: "sync_check", sha: "h1" }, noReconcile)).rejects.toThrow("timed out");
    expect(writes(ctx.ghost).at(-1)?.body).toMatchObject({ conclusion: "failure", output: { summary: "git fetch timed out" } });
  });
});
