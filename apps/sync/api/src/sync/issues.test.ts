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
    expect(ctx.store.activity.map((a) => [a.direction, a.kind, a.summary, a.error])).toEqual([
      ["ghost", "label", "Created label bug", null],
      ["ghost", "issue", "Copied GitHub issue #5 as #12", null],
    ]);
  });

  describe("an issue that already has a twin on the other side", () => {
    const twin = (overrides: Record<string, unknown> = {}) => ({ number: 12, node_id: "I_g12", title: "Crash on save", body: "Steps\n\nGitHub twin: #5", state: "closed", user: { login: "bob" }, labels: [], ...overrides });

    test("is paired instead of copied, and nothing is written to either side", async () => {
      const ctx = testContext({
        github: { "GET /repos/acme-gh/app/issues/5": githubIssue() },
        ghost: { "GET /repos/acme/app/issues?state=all": [{ ...twin({ number: 11, title: "Other" }) }, twin()] },
      });
      expect(await syncIssue(ctx, "github", 5)).toBe(12);
      expect(writes(ctx.ghost)).toEqual([]);
      expect(await ctx.store.findLink(ctx.sync.id, "issue", "github", "5")).toMatchObject({ ghostId: "12" });
      expect(ctx.store.activity.map((a) => [a.direction, a.summary])).toEqual([["ghost", "Paired GitHub issue #5 with its twin, Ghost issue #12"]]);
    });

    test("the pair's differing body and state stay as they are on the next pass from either side", async () => {
      const ctx = testContext({
        github: { "GET /repos/acme-gh/app/issues/5": githubIssue(), "GET /repos/acme-gh/app/labels/bug": bug },
        ghost: { "GET /repos/acme/app/issues?state=all": [twin()], "GET /repos/acme/app/issues/12": twin(), ...ghostLabelExists },
      });
      await syncIssue(ctx, "github", 5);
      await syncIssue(ctx, "github", 5);
      await syncIssue(ctx, "ghost", 12);
      expect([...writes(ctx.ghost), ...writes(ctx.github)].filter((c) => c.path.includes("/issues"))).toEqual([]);
    });

    test("our own copies, pull requests and already linked issues are not twins", async () => {
      const ctx = testContext({
        github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ labels: [] }) },
        ghost: {
          "GET /repos/acme/app/issues?state=all": [twin({ number: 10, user: { login: "ghost-sync[bot]" } }), twin({ number: 11, pull_request: {} }), twin()],
          "POST /repos/acme/app/issues": { number: 13 },
        },
      });
      await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "4" });
      expect(await syncIssue(ctx, "github", 5)).toBe(13);
    });

    test("two issues with the same title are no twin, so the issue is copied", async () => {
      const ctx = testContext({
        github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ labels: [] }) },
        ghost: { "GET /repos/acme/app/issues?state=all": [twin({ number: 11 }), twin()], "POST /repos/acme/app/issues": { number: 13 } },
      });
      expect(await syncIssue(ctx, "github", 5)).toBe(13);
    });
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

  const ghostCopy = (overrides: Record<string, unknown> = {}) => ({ number: 12, node_id: "I_g12", title: "Crash on save", body: withMarker("Steps", "github", "alice"), state: "open", user: { login: "ghost-sync[bot]" }, labels: [bug], ...overrides });
  const agreed = { title: "Crash on save", body: "Steps", state: "open", labels: ["bug"] };
  const linked = (ctx: ReturnType<typeof testContext>, synced: Record<string, unknown> | null = agreed) =>
    ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5", synced: synced as typeof agreed });

  test("linked: only what changed is written, each change logged, nothing created", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ state: "closed", title: "Crash on save as" }) },
      ghost: { ...ghostLabelExists, "GET /repos/acme/app/issues/12": ghostCopy(), "PATCH /repos/acme/app/issues/12": {} },
    });
    await linked(ctx);
    expect(await syncIssue(ctx, "github", 5)).toBe(12);
    expect(writes(ctx.ghost)).toEqual([{ method: "PATCH", path: "/repos/acme/app/issues/12", body: { title: "Crash on save as", state: "closed" } }]);
    expect(ctx.store.activity.map((a) => a.summary)).toEqual(['Retitled Ghost issue #12 to "Crash on save as"', "Closed Ghost issue #12"]);
    expect((await ctx.store.findLink(ctx.sync.id, "issue", "github", "5"))?.synced).toEqual({ ...agreed, title: "Crash on save as", state: "closed" });
  });

  test("linked: a reopen is copied and logged", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue() },
      ghost: { ...ghostLabelExists, "GET /repos/acme/app/issues/12": ghostCopy({ state: "closed" }), "PATCH /repos/acme/app/issues/12": {} },
    });
    await linked(ctx, { ...agreed, state: "closed" });
    await syncIssue(ctx, "github", 5);
    expect(writes(ctx.ghost)).toEqual([{ method: "PATCH", path: "/repos/acme/app/issues/12", body: { state: "open" } }]);
    expect(ctx.store.activity.map((a) => a.summary)).toEqual(["Reopened Ghost issue #12"]);
  });

  test("linked: a close made on the other side and not yet copied is never undone", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ updated_at: "2026-11-22T17:10:00Z" }) },
      ghost: { ...ghostLabelExists, "GET /repos/acme/app/issues/12": ghostCopy({ state: "closed", updated_at: "2026-11-22T17:00:00Z" }) },
    });
    await linked(ctx);
    await syncIssue(ctx, "github", 5);
    expect(writes(ctx.ghost)).toEqual([]);
    expect(ctx.store.activity).toEqual([]);
  });

  test("linked: sides that already agree are left alone", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue() },
      ghost: { ...ghostLabelExists, "GET /repos/acme/app/issues/12": ghostCopy() },
    });
    await linked(ctx, null);
    await syncIssue(ctx, "github", 5);
    expect(writes(ctx.ghost)).toEqual([]);
    expect((await ctx.store.findLink(ctx.sync.id, "issue", "github", "5"))?.synced).toEqual(agreed);
  });

  test("linked: with no agreed state the side changed last wins", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ state: "closed", updated_at: "2026-11-22T17:00:00Z" }) },
      ghost: { ...ghostLabelExists, "GET /repos/acme/app/issues/12": ghostCopy({ updated_at: "2026-11-22T17:10:00Z" }) },
    });
    await linked(ctx, null);
    await syncIssue(ctx, "github", 5);
    expect(writes(ctx.ghost)).toEqual([]);
  });

  test("linked: a copy that is gone is logged and skipped", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/issues/5": githubIssue() }, ghost: ghostLabelExists });
    await linked(ctx);
    expect(await syncIssue(ctx, "github", 5)).toBe(12);
    expect(ctx.store.activity).toEqual([expect.objectContaining({ direction: "ghost", kind: "issue", error: expect.stringContaining("404") })]);
  });

  test("an unlinked issue written by our bot is left alone", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ user: { login: "ghost-sync[bot]" } }) } });
    await syncIssue(ctx, "github", 5);
    expect(ctx.ghost.calls).toEqual([]);
  });

  test("an edit made on our copy goes back to the original without a marker", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ user: { login: "ghost-sync[bot]" }, body: withMarker("Edited on GitHub", "ghost", "bob"), labels: [] }) },
      ghost: { "GET /repos/acme/app/issues/12": ghostCopy({ user: { login: "bob" }, body: "Steps", labels: [] }), "PATCH /repos/acme/app/issues/12": {} },
    });
    await linked(ctx, { ...agreed, labels: [] });
    await syncIssue(ctx, "github", 5);
    expect(writes(ctx.ghost)).toEqual([{ method: "PATCH", path: "/repos/acme/app/issues/12", body: { body: "Edited on GitHub" } }]);
    expect(ctx.store.activity.map((a) => a.summary)).toEqual(["Edited the description of Ghost issue #12"]);
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

describe("a create whose answer was lost", () => {
  const recent = (issues: unknown[]) => ({ "GET /repos/acme/app/issues?creator=ghost-sync%5Bbot%5D&state=all&sort=created&direction=desc&per_page=30": issues });

  test("finds our copy instead of creating it twice", async () => {
    const copy = { number: 12, title: "Crash on save", body: withMarker("Steps", "github", "alice"), user: { login: "ghost-sync[bot]" } };
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ labels: [] }) },
      ghost: {
        ...recent([{ ...copy, number: 11, title: "Other" }, copy]),
        "POST /repos/acme/app/issues": () => {
          throw new RestError(502, { message: "Bad Gateway" });
        },
      },
    });
    expect(await syncIssue(ctx, "github", 5)).toBe(12);
    expect(await ctx.store.findLink(ctx.sync.id, "issue", "github", "5")).toMatchObject({ ghostId: "12" });
  });

  test("fails when no copy landed, so the job can be retried", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ labels: [] }) },
      ghost: {
        ...recent([]),
        "POST /repos/acme/app/issues": () => {
          throw new TypeError("fetch failed");
        },
      },
    });
    await expect(syncIssue(ctx, "github", 5)).rejects.toThrow("fetch failed");
    expect(await ctx.store.findLink(ctx.sync.id, "issue", "github", "5")).toBeNull();
  });

  test("a refusal is not looked for, since nothing was created", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/5": githubIssue({ labels: [] }) },
      ghost: {
        "POST /repos/acme/app/issues": () => {
          throw new RestError(422, { message: "Validation Failed" });
        },
      },
    });
    await expect(syncIssue(ctx, "github", 5)).rejects.toMatchObject({ status: 422 });
    // The GET is the twin lookup before the create; nothing is looked for after it.
    expect(ctx.ghost.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });
});

describe("syncIssue leaves pull requests to syncPull", () => {
  test("an unlinked pull request is not copied as an issue", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/issues/8": githubIssue({ number: 8, pull_request: { url: "x" } }) } });
    expect(await syncIssue(ctx, "github", 8)).toBeNull();
    expect(ctx.ghost.calls).toEqual([]);
  });
});

describe("deleteIssue when the copy is already gone", () => {
  test("only the link goes", async () => {
    const ctx = testContext();
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await deleteIssue(ctx, "github", 5);
    expect(writes(ctx.ghost)).toEqual([]);
    expect(await ctx.store.findLink(ctx.sync.id, "issue", "github", "5")).toBeNull();
  });
});

describe("label edge cases", () => {
  test("a label already alike is left alone", async () => {
    const ctx = testContext({ ghost: ghostLabelExists, github: { "GET /repos/acme-gh/app/labels/bug": bug } });
    await syncLabelDefinition(ctx, "ghost", "bug");
    expect(writes(ctx.github)).toEqual([]);
  });

  test("a renamed label renames its counterpart instead of adding a second", async () => {
    const renamed = { ...bug, name: "defect" };
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/labels/defect": renamed }, ghost: { "GET /repos/acme/app/labels/bug": bug, "PATCH /repos/acme/app/labels/bug": renamed } });
    await syncLabelDefinition(ctx, "github", "defect", "bug");
    expect(writes(ctx.ghost)).toEqual([{ method: "PATCH", path: "/repos/acme/app/labels/bug", body: { new_name: "defect", color: "d73a4a", description: "Something is broken" } }]);
  });

  test("a rename whose old label is missing on the other side creates it", async () => {
    const renamed = { ...bug, name: "defect" };
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/labels/defect": renamed }, ghost: { "POST /repos/acme/app/labels": renamed } });
    await syncLabelDefinition(ctx, "github", "defect", "bug");
    expect(writes(ctx.ghost)).toEqual([{ method: "POST", path: "/repos/acme/app/labels", body: renamed }]);
  });

  test("a label gone from its source is skipped and logged", async () => {
    const ctx = testContext();
    await syncLabelDefinition(ctx, "ghost", "bug");
    expect(ctx.store.activity).toEqual([expect.objectContaining({ direction: "github", kind: "label", error: expect.stringContaining("404") })]);
  });
});
