import { describe, expect, test } from "bun:test";
import { withMarker } from "../format.ts";
import { writes } from "../lib/fake-rest.ts";
import { testContext } from "../lib/test-context.ts";
import { RestError } from "../rest.ts";
import { deleteIssue, deleteLabelDefinition, syncIssue, syncLabelDefinition } from "./issues.ts";

const bug = { name: "bug", color: "d73a4a", description: "Something is broken" };
const githubIssue = (overrides: Record<string, unknown> = {}) => ({
  number: 5,
  node_id: "I_gh5",
  title: "Crash on save",
  body: "Steps",
  state: "open",
  user: { login: "alice" },
  labels: [bug],
  ...overrides,
});
const ghostLabelExists = { "GET /repos/acme/app/labels/bug": bug };

describe("syncIssue", () => {
  test("unlinked: the missing label is created, then the issue, attributed, and linked", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue() },
      ghost: { "POST /repos/acme/app/labels": bug, "POST /repos/acme/app/issues": { number: 12, node_id: "I_g12" } },
    });
    expect(await syncIssue(ctx, "github", 5)).toBe(12);
    expect(writes(ctx.ghost)).toEqual([
      { method: "POST", path: "/repos/acme/app/labels", body: bug },
      { method: "POST", path: "/repos/acme/app/issues", body: { title: "Crash on save", body: withMarker("Steps", "github", "alice"), labels: ["bug"] } },
    ]);
    expect(await ctx.store.findLink(ctx.sync.id, "issue", "github", "5")).toMatchObject({ ghostId: "12" });
  });

  test("a null body copies as empty", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ body: null, labels: [] }) },
      ghost: { "POST /repos/acme/app/issues": { number: 12 } },
    });
    await syncIssue(ctx, "github", 5);
    expect(writes(ctx.ghost)[0]?.body).toMatchObject({ body: withMarker("", "github", "alice") });
  });

  test("a closed issue is created then closed", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ state: "closed", labels: [] }) },
      ghost: { "POST /repos/acme/app/issues": { number: 12 }, "PATCH /repos/acme/app/issues/12": {} },
    });
    await syncIssue(ctx, "github", 5);
    expect(writes(ctx.ghost)[1]).toEqual({ method: "PATCH", path: "/repos/acme/app/issues/12", body: expect.objectContaining({ state: "closed" }) });
  });

  test("Ghost to GitHub works the same way", async () => {
    const ctx = testContext({
      ghost: { "GET /repos/acme/app/issues/12": { number: 12, title: "T", body: "B", state: "open", user: { login: "bob" }, labels: [] } },
      github: { "POST /repos/acme-gh/app/issues": { number: 5 } },
    });
    expect(await syncIssue(ctx, "ghost", 12)).toBe(5);
    expect(writes(ctx.github)[0]?.body).toEqual({ title: "T", body: withMarker("B", "ghost", "bob"), labels: [] });
  });

  test("linked: title, body, state and labels follow, nothing is created", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ state: "closed" }) },
      ghost: { ...ghostLabelExists, "PATCH /repos/acme/app/issues/12": {} },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    expect(await syncIssue(ctx, "github", 5)).toBe(12);
    expect(writes(ctx.ghost)).toEqual([
      { method: "PATCH", path: "/repos/acme/app/issues/12", body: { title: "Crash on save", body: withMarker("Steps", "github", "alice"), state: "closed", labels: ["bug"] } },
    ]);
  });

  test("an unlinked issue written by our bot is left alone", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ user: { login: "ghost-sync[bot]" } }) } });
    await syncIssue(ctx, "github", 5);
    expect(ctx.ghost.calls).toEqual([]);
  });

  test("an edit made on our copy goes back to the original without a marker", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ user: { login: "ghost-sync[bot]" }, body: withMarker("Edited on GitHub", "ghost", "bob"), labels: [] }) },
      ghost: { "PATCH /repos/acme/app/issues/12": {} },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await syncIssue(ctx, "github", 5);
    expect(writes(ctx.ghost)[0]?.body).toMatchObject({ body: "Edited on GitHub" });
  });

  test("a vanished source writes a skipped activity row and does not throw", async () => {
    const ctx = testContext();
    await syncIssue(ctx, "github", 5);
    expect(ctx.store.activity).toEqual([expect.objectContaining({ syncId: ctx.sync.id, direction: "ghost", error: expect.stringContaining("404") })]);
  });
});

describe("deleteIssue", () => {
  test("linked: deleteIssue on the other side by node id, then unlinked", async () => {
    const ctx = testContext({
      ghost: { "GET /repos/acme/app/issues/12": { number: 12, node_id: "I_g12" }, "GRAPHQL deleteIssue": { deleteIssue: { clientMutationId: null } } },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await deleteIssue(ctx, "github", 5);
    const call = ctx.ghost.calls.find((c) => c.method === "GRAPHQL");
    expect(call?.path).toBe("deleteIssue");
    expect(JSON.stringify(call?.body)).toContain("I_g12");
    expect(await ctx.store.findLink(ctx.sync.id, "issue", "github", "5")).toBeNull();
  });

  test("unlinked: nothing", async () => {
    const ctx = testContext();
    await deleteIssue(ctx, "github", 5);
    expect(ctx.ghost.calls).toEqual([]);
  });

  test("refused: the copy is closed with a comment and the refusal logged", async () => {
    const ctx = testContext({
      github: {
        "GET /repos/acme-gh/app/issues/5": { number: 5, node_id: "I_gh5" },
        "GRAPHQL deleteIssue": () => {
          throw new RestError(200, [{ message: "Resource not accessible by integration" }]);
        },
        "POST /repos/acme-gh/app/issues/5/comments": { id: 1 },
        "PATCH /repos/acme-gh/app/issues/5": {},
      },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await deleteIssue(ctx, "ghost", 12);
    expect(writes(ctx.github).filter((c) => c.method !== "GRAPHQL")).toEqual([
      { method: "POST", path: "/repos/acme-gh/app/issues/5/comments", body: { body: "Deleted on Ghost" } },
      { method: "PATCH", path: "/repos/acme-gh/app/issues/5", body: { state: "closed" } },
    ]);
    expect(ctx.store.activity).toHaveLength(1);
  });
});

describe("labels", () => {
  test("a label edited on Ghost is created on GitHub when missing", async () => {
    const ctx = testContext({ ghost: ghostLabelExists, github: { "POST /repos/acme-gh/app/labels": bug } });
    await syncLabelDefinition(ctx, "ghost", "bug");
    expect(writes(ctx.github)).toEqual([{ method: "POST", path: "/repos/acme-gh/app/labels", body: bug }]);
  });

  test("and updated when present", async () => {
    const ctx = testContext({
      ghost: ghostLabelExists,
      github: { "GET /repos/acme-gh/app/labels/bug": { ...bug, color: "000000" }, "PATCH /repos/acme-gh/app/labels/bug": bug },
    });
    await syncLabelDefinition(ctx, "ghost", "bug");
    expect(writes(ctx.github)).toEqual([{ method: "PATCH", path: "/repos/acme-gh/app/labels/bug", body: { color: "d73a4a", description: "Something is broken" } }]);
  });

  test("names with spaces are encoded in paths", async () => {
    const label = { name: "good first issue", color: "7057ff", description: null };
    const ctx = testContext({ ghost: { "GET /repos/acme/app/labels/good%20first%20issue": label }, github: { "POST /repos/acme-gh/app/labels": label } });
    await syncLabelDefinition(ctx, "ghost", "good first issue");
    expect(writes(ctx.github)).toHaveLength(1);
  });

  test("a deleted label is deleted by name; already gone is fine", async () => {
    const ctx = testContext({ ghost: { "DELETE /repos/acme/app/labels/bug": undefined } });
    await deleteLabelDefinition(ctx, "github", "bug");
    expect(writes(ctx.ghost)).toEqual([{ method: "DELETE", path: "/repos/acme/app/labels/bug" }]);
    await deleteLabelDefinition(ctx, "github", "gone");
  });
});
