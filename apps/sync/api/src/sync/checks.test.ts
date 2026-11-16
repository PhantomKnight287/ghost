import { describe, expect, test } from "bun:test";
import { writes } from "../lib/fake-rest.ts";
import { RestError } from "../rest.ts";
import { testContext } from "../lib/test-context.ts";
import { finishSyncCheck, startSyncCheck, syncCheckRun } from "./checks.ts";

const actionsRun = (overrides: Record<string, unknown> = {}) => ({
  id: 1001,
  name: "CI / test",
  head_sha: "h1",
  status: "completed",
  conclusion: "success",
  output: { title: "All green", summary: "42 passed" },
  html_url: "https://github.com/acme-gh/app/runs/1001",
  details_url: "https://ci.example.com/1",
  app: { slug: "github-actions" },
  ...overrides,
});
const commitExists = { "GET /repos/acme/app/commits/h1": { sha: "h1" } };

describe("syncCheckRun", () => {
  test("a GitHub run is copied onto the same Ghost commit, pointing back at GitHub, and linked", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/check-runs/1001": actionsRun() }, ghost: { ...commitExists, "POST /repos/acme/app/check-runs": { id: 55 } } });
    await syncCheckRun(ctx, "github", "1001");
    expect(writes(ctx.ghost)).toEqual([
      {
        method: "POST",
        path: "/repos/acme/app/check-runs",
        body: { name: "CI / test", head_sha: "h1", status: "completed", conclusion: "success", output: { title: "All green", summary: "42 passed" }, details_url: "https://github.com/acme-gh/app/runs/1001" },
      },
    ]);
    expect(await ctx.store.findLink(ctx.sync.id, "check_run", "github", "1001")).toMatchObject({ ghostId: "55" });
  });

  test("an in-progress run carries no conclusion", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/check-runs/1001": actionsRun({ status: "in_progress", conclusion: null }) }, ghost: { ...commitExists, "POST /repos/acme/app/check-runs": { id: 55 } } });
    await syncCheckRun(ctx, "github", "1001");
    expect(writes(ctx.ghost)[0]?.body).not.toHaveProperty("conclusion");
  });

  test("linked: the copy is updated in place", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/check-runs/1001": actionsRun({ conclusion: "failure" }) }, ghost: { "PATCH /repos/acme/app/check-runs/55": {} } });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "check_run", ghostId: "55", ghostRestId: "55", githubId: "1001" });
    await syncCheckRun(ctx, "github", "1001");
    expect(writes(ctx.ghost)).toEqual([{ method: "PATCH", path: "/repos/acme/app/check-runs/55", body: expect.objectContaining({ conclusion: "failure", status: "completed" }) }]);
  });

  test("Ghost to GitHub the same way", async () => {
    const ctx = testContext({
      ghost: { "GET /repos/acme/app/check-runs/55": actionsRun({ id: 55, html_url: "https://ghost.example.com/acme/app/checks/55", app: { slug: "ghost-ci" } }) },
      github: { "GET /repos/acme-gh/app/commits/h1": { sha: "h1" }, "POST /repos/acme-gh/app/check-runs": { id: 1001 } },
    });
    await syncCheckRun(ctx, "ghost", "55");
    expect(writes(ctx.github)[0]?.body).toMatchObject({ name: "CI / test", details_url: "https://ghost.example.com/acme/app/checks/55" });
  });

  test("our own runs are never copied back", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/check-runs/1001": actionsRun({ app: { slug: "ghost-sync" } }) } });
    await syncCheckRun(ctx, "github", "1001");
    expect(ctx.ghost.calls).toEqual([]);
  });

  test("a commit not yet on the other side is skipped for reconcile to pick up", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/check-runs/1001": actionsRun() } });
    await syncCheckRun(ctx, "github", "1001");
    expect(writes(ctx.ghost)).toEqual([]);
    expect(await ctx.store.findLink(ctx.sync.id, "check_run", "github", "1001")).toBeNull();
  });
});

describe("the sync check", () => {
  test("starts in progress on the Ghost commit", async () => {
    const ctx = testContext({ ghost: { "POST /repos/acme/app/check-runs": { id: 77 } } });
    expect(await startSyncCheck(ctx, "h1")).toBe("77");
    expect(writes(ctx.ghost)).toEqual([{ method: "POST", path: "/repos/acme/app/check-runs", body: { name: "Sync with GitHub", head_sha: "h1", status: "in_progress" } }]);
  });

  test("finishes success", async () => {
    const ctx = testContext({ ghost: { "PATCH /repos/acme/app/check-runs/77": {} } });
    await finishSyncCheck(ctx, "77", { ok: true });
    expect(writes(ctx.ghost)[0]?.body).toMatchObject({ status: "completed", conclusion: "success" });
  });

  test("finishes failure with the reason", async () => {
    const ctx = testContext({ ghost: { "PATCH /repos/acme/app/check-runs/77": {} } });
    await finishSyncCheck(ctx, "77", { ok: false, reason: "refs/heads/main diverged" });
    expect(writes(ctx.ghost)[0]?.body).toMatchObject({ status: "completed", conclusion: "failure", output: expect.objectContaining({ summary: "refs/heads/main diverged" }) });
  });
});

describe("check run edge cases", () => {
  const listed = (runs: unknown[]) => ({ "GET /repos/acme/app/commits/h1/check-runs?check_name=CI+%2F+test": { total_count: runs.length, check_runs: runs } });

  test("an update never tries to move the run to another commit", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/check-runs/1001": actionsRun() }, ghost: { "PATCH /repos/acme/app/check-runs/55": {} } });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "check_run", ghostId: "55", ghostRestId: "55", githubId: "1001" });
    await syncCheckRun(ctx, "github", "1001");
    expect(writes(ctx.ghost)[0]?.body).not.toHaveProperty("head_sha");
  });

  test("a status only Actions may set is copied as queued", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/check-runs/1001": actionsRun({ status: "waiting", conclusion: null }) }, ghost: { ...commitExists, "POST /repos/acme/app/check-runs": { id: 55 } } });
    await syncCheckRun(ctx, "github", "1001");
    expect(writes(ctx.ghost)[0]?.body).toMatchObject({ status: "queued" });
  });

  test("the output's text comes along", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/check-runs/1001": actionsRun({ output: { title: "t", summary: "s", text: "details" } }) }, ghost: { ...commitExists, "POST /repos/acme/app/check-runs": { id: 55 } } });
    await syncCheckRun(ctx, "github", "1001");
    expect(writes(ctx.ghost)[0]?.body).toMatchObject({ output: { title: "t", summary: "s", text: "details" } });
  });

  test("GitHub's 422 for an unknown commit means not there yet", async () => {
    const ctx = testContext({
      ghost: { "GET /repos/acme/app/check-runs/55": actionsRun({ id: 55, app: { slug: "ghost-ci" } }) },
      github: {
        "GET /repos/acme-gh/app/commits/h1": () => {
          throw new RestError(422, { message: "No commit found for SHA: h1" });
        },
      },
    });
    await syncCheckRun(ctx, "ghost", "55");
    expect(writes(ctx.github)).toEqual([]);
  });

  test("a copy whose answer was lost is found by its link back to the original", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/check-runs/1001": actionsRun() },
      ghost: {
        ...commitExists,
        ...listed([
          { id: 54, name: "CI / test", app: { slug: "ghost-sync" }, details_url: "https://github.com/acme-gh/app/runs/999" },
          { id: 55, name: "CI / test", app: { slug: "ghost-sync" }, details_url: "https://github.com/acme-gh/app/runs/1001" },
        ]),
        "POST /repos/acme/app/check-runs": () => {
          throw new RestError(502, { message: "Bad Gateway" });
        },
      },
    });
    await syncCheckRun(ctx, "github", "1001");
    expect(await ctx.store.findLink(ctx.sync.id, "check_run", "github", "1001")).toMatchObject({ ghostId: "55" });
  });

  test("a sync check whose answer was lost is found instead of left open twice", async () => {
    const ctx = testContext({
      ghost: {
        "GET /repos/acme/app/commits/h1/check-runs?check_name=Sync+with+GitHub": { total_count: 1, check_runs: [{ id: 77, name: "Sync with GitHub", status: "in_progress", app: { slug: "ghost-sync" } }] },
        "POST /repos/acme/app/check-runs": () => {
          throw new TypeError("fetch failed");
        },
      },
    });
    expect(await startSyncCheck(ctx, "h1")).toBe("77");
  });
});

