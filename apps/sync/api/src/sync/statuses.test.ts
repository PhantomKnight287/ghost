import { describe, expect, test } from "bun:test";
import { writes } from "../lib/fake-rest.ts";
import { testContext } from "../lib/test-context.ts";
import { RestError } from "../rest.ts";
import { syncStatuses } from "./statuses.ts";

const status = (context: string, state: string, login: string, overrides: Record<string, unknown> = {}) => ({
  context,
  state,
  description: `${context} ${state}`,
  target_url: `https://deploy.example.com/${context}`,
  creator: { login },
  ...overrides,
});
const onGhost = { "GET /repos/acme/app/commits/h1": { sha: "h1" } };

describe("syncStatuses", () => {
  test("the latest status of each context on GitHub is posted onto the same Ghost commit, keeping its link", async () => {
    const ctx = testContext({
      // Newest first, as both hosts list them.
      github: { "GET /repos/acme-gh/app/commits/h1/statuses": [status("Vercel", "success", "vercel[bot]"), status("Ghost - api", "success", "railway-app[bot]"), status("Vercel", "pending", "vercel[bot]")] },
      ghost: { ...onGhost, "GET /repos/acme/app/commits/h1/statuses": [], "POST /repos/acme/app/statuses/h1": {} },
    });
    await syncStatuses(ctx, "github", "h1");
    expect(writes(ctx.ghost)).toEqual([
      { method: "POST", path: "/repos/acme/app/statuses/h1", body: { context: "Vercel", state: "success", description: "Vercel success", target_url: "https://deploy.example.com/Vercel" } },
      { method: "POST", path: "/repos/acme/app/statuses/h1", body: { context: "Ghost - api", state: "success", description: "Ghost - api success", target_url: "https://deploy.example.com/Ghost - api" } },
    ]);
    expect(ctx.store.activity.map((a) => [a.direction, a.kind, a.summary])).toEqual([
      ["ghost", "status", "Copied status Vercel on h1: success"],
      ["ghost", "status", "Copied status Ghost - api on h1: success"],
    ]);
  });

  test("Ghost to GitHub the same way", async () => {
    const ctx = testContext({
      ghost: { "GET /repos/acme/app/commits/h1/statuses": [status("ghost-ci", "failure", "ci[bot]")] },
      github: { "GET /repos/acme-gh/app/commits/h1": { sha: "h1" }, "GET /repos/acme-gh/app/commits/h1/statuses": [], "POST /repos/acme-gh/app/statuses/h1": {} },
    });
    await syncStatuses(ctx, "ghost", "h1");
    expect(writes(ctx.github)).toEqual([{ method: "POST", path: "/repos/acme-gh/app/statuses/h1", body: { context: "ghost-ci", state: "failure", description: "ghost-ci failure", target_url: "https://deploy.example.com/ghost-ci" } }]);
  });

  test("a status with no description or link is copied without them", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/commits/h1/statuses": [status("Vercel", "pending", "vercel[bot]", { description: null, target_url: null })] },
      ghost: { ...onGhost, "GET /repos/acme/app/commits/h1/statuses": [], "POST /repos/acme/app/statuses/h1": {} },
    });
    await syncStatuses(ctx, "github", "h1");
    expect(writes(ctx.ghost)[0]?.body).toEqual({ context: "Vercel", state: "pending" });
  });

  test("a copy already matching its source is not posted again", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/commits/h1/statuses": [status("Vercel", "success", "vercel[bot]")] },
      ghost: { ...onGhost, "GET /repos/acme/app/commits/h1/statuses": [status("Vercel", "success", "ghost-sync[bot]")] },
    });
    await syncStatuses(ctx, "github", "h1");
    expect(writes(ctx.ghost)).toEqual([]);
    expect(ctx.store.activity).toEqual([]);
  });

  test("a newer source state replaces the copy", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/commits/h1/statuses": [status("Vercel", "success", "vercel[bot]"), status("Vercel", "pending", "vercel[bot]")] },
      ghost: { ...onGhost, "GET /repos/acme/app/commits/h1/statuses": [status("Vercel", "pending", "ghost-sync[bot]")], "POST /repos/acme/app/statuses/h1": {} },
    });
    await syncStatuses(ctx, "github", "h1");
    expect(writes(ctx.ghost).map((c) => (c.body as { state: string }).state)).toEqual(["success"]);
  });

  test("our own copies are never copied back (Review Focus 4)", async () => {
    const ctx = testContext({ ghost: { "GET /repos/acme/app/commits/h1/statuses": [status("Vercel", "success", "ghost-sync[bot]")] } });
    await syncStatuses(ctx, "ghost", "h1");
    expect(writes(ctx.github)).toEqual([]);
    expect(ctx.github.calls).toEqual([]);
  });

  test("a context someone else reports on the other side is left to them", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/commits/h1/statuses": [status("ci", "failure", "github-ci[bot]")] },
      ghost: { ...onGhost, "GET /repos/acme/app/commits/h1/statuses": [status("ci", "success", "ghost-ci[bot]")] },
    });
    await syncStatuses(ctx, "github", "h1");
    expect(writes(ctx.ghost)).toEqual([]);
  });

  test("a commit the other side lacks yet is skipped silently for reconcile", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/commits/h1/statuses": [status("Vercel", "success", "vercel[bot]")] } });
    await syncStatuses(ctx, "github", "h1");
    expect(writes(ctx.ghost)).toEqual([]);
    expect(ctx.store.activity).toEqual([]);
  });

  test("a source commit that is gone copies nothing", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/commits/h1/statuses": () => { throw new RestError(422, { message: "No commit found for SHA: h1" }); } } });
    await syncStatuses(ctx, "github", "h1");
    expect(ctx.ghost.calls).toEqual([]);
  });

  test("a refused post is logged and the other contexts still copy", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/commits/h1/statuses": [status("bad", "success", "x[bot]"), status("Vercel", "success", "vercel[bot]")] },
      ghost: {
        ...onGhost,
        "GET /repos/acme/app/commits/h1/statuses": [],
        "POST /repos/acme/app/statuses/h1": (body: unknown) => {
          if ((body as { context: string }).context === "bad") throw new RestError(422, { message: "Validation Failed" });
          return {};
        },
      },
    });
    await syncStatuses(ctx, "github", "h1");
    expect(ctx.store.activity.map((a) => [a.summary, a.error])).toEqual([
      ["Could not copy status bad on h1", "422 Validation Failed"],
      ["Copied status Vercel on h1: success", null],
    ]);
  });
});
