import { describe, expect, test } from "bun:test";
import { withMarker } from "../format.ts";
import { writes } from "../lib/fake-rest.ts";
import { ghostNodeId, testContext } from "../lib/test-context.ts";
import { ghostKeyOfNodeId } from "./issues.ts";
import { deleteComment, syncComment } from "./comments.ts";

const uuid = "0b7c3a52-5a0e-4c1e-9d55-6f1f6b1b2c3d";
const ghostComment = { id: 301, node_id: ghostNodeId("IC", uuid), body: "hi", user: { login: "bob" } };

test("ghostKeyOfNodeId reads the UUID out of Ghost's node_id", () => {
  expect(ghostKeyOfNodeId(ghostNodeId("IC", uuid))).toBe(uuid);
  expect(ghostKeyOfNodeId(ghostNodeId("PRR", uuid))).toBe(uuid);
});

describe("syncComment", () => {
  test("a Ghost comment is found from its webhook UUID, copied and linked with its REST id", async () => {
    const ctx = testContext({
      ghost: { "GET /repos/acme/app/issues/12/comments": [{ ...ghostComment, id: 300, node_id: ghostNodeId("IC", "other") }, ghostComment] },
      github: { "POST /repos/acme-gh/app/issues/5/comments": { id: 9001 } },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await syncComment(ctx, "ghost", 12, uuid);
    expect(writes(ctx.github)).toEqual([{ method: "POST", path: "/repos/acme-gh/app/issues/5/comments", body: { body: withMarker("hi", "ghost", "bob") } }]);
    expect(await ctx.store.findLink(ctx.sync.id, "comment", "ghost", uuid)).toMatchObject({ ghostRestId: "301", githubId: "9001" });
  });

  test("a GitHub comment is read by id and copied to Ghost, keyed by the new comment's UUID", async () => {
    const created = { id: 302, node_id: ghostNodeId("IC", uuid) };
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/comments/9001": { id: 9001, body: "yo", user: { login: "coderabbitai[bot]" } } },
      ghost: { "POST /repos/acme/app/issues/12/comments": created },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await syncComment(ctx, "github", 5, "9001");
    expect(writes(ctx.ghost)[0]?.body).toEqual({ body: withMarker("yo", "github", "coderabbitai[bot]") });
    expect(await ctx.store.findLink(ctx.sync.id, "comment", "github", "9001")).toMatchObject({ ghostId: uuid, ghostRestId: "302" });
  });

  test("a comment on a pull request uses the pull request's link", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/comments/9001": { id: 9001, body: "yo", user: { login: "x" } } },
      ghost: { "POST /repos/acme/app/issues/3/comments": { id: 302, node_id: ghostNodeId("IC", uuid) } },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "pull", ghostId: "3", ghostRestId: null, githubId: "8" });
    await syncComment(ctx, "github", 8, "9001");
    expect(writes(ctx.ghost)[0]?.path).toBe("/repos/acme/app/issues/3/comments");
  });

  test("linked: the body is edited in place", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/comments/9001": { id: 9001, body: "edited", user: { login: "x" } } },
      ghost: { "PATCH /repos/acme/app/issues/comments/301": {} },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "comment", ghostId: uuid, ghostRestId: "301", githubId: "9001" });
    await syncComment(ctx, "github", 5, "9001");
    expect(writes(ctx.ghost)).toEqual([{ method: "PATCH", path: "/repos/acme/app/issues/comments/301", body: { body: withMarker("edited", "github", "x") } }]);
  });

  test("an unlinked parent issue is synced first", async () => {
    const ctx = testContext({
      github: {
        "GET /repos/acme-gh/app/issues/5": { number: 5, title: "T", body: "B", state: "open", user: { login: "alice" }, labels: [] },
        "GET /repos/acme-gh/app/issues/comments/9001": { id: 9001, body: "yo", user: { login: "x" } },
      },
      ghost: { "POST /repos/acme/app/issues": { number: 12 }, "POST /repos/acme/app/issues/12/comments": { id: 302, node_id: ghostNodeId("IC", uuid) } },
    });
    await syncComment(ctx, "github", 5, "9001");
    expect(writes(ctx.ghost).map((c) => c.path)).toEqual(["/repos/acme/app/issues", "/repos/acme/app/issues/12/comments"]);
  });

  test("an unlinked comment written by our bot is left alone", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/issues/comments/9001": { id: 9001, body: "x", user: { login: "ghost-sync[bot]" } } } });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await syncComment(ctx, "github", 5, "9001");
    expect(writes(ctx.ghost)).toEqual([]);
  });

  test("a 404 writes a skipped activity row and does not throw", async () => {
    const ctx = testContext();
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await syncComment(ctx, "ghost", 12, uuid);
    expect(ctx.store.activity).toEqual([expect.objectContaining({ error: expect.stringContaining("404") })]);
  });
});

describe("deleteComment", () => {
  test("GitHub to Ghost deletes by the stored REST id and unlinks", async () => {
    const ctx = testContext({ ghost: { "DELETE /repos/acme/app/issues/comments/301": undefined } });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "comment", ghostId: uuid, ghostRestId: "301", githubId: "9001" });
    await deleteComment(ctx, "github", "9001");
    expect(writes(ctx.ghost)).toEqual([{ method: "DELETE", path: "/repos/acme/app/issues/comments/301" }]);
    expect(await ctx.store.findLink(ctx.sync.id, "comment", "ghost", uuid)).toBeNull();
  });

  test("Ghost to GitHub deletes by GitHub id", async () => {
    const ctx = testContext({ github: { "DELETE /repos/acme-gh/app/issues/comments/9001": undefined } });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "comment", ghostId: uuid, ghostRestId: "301", githubId: "9001" });
    await deleteComment(ctx, "ghost", uuid);
    expect(writes(ctx.github)).toEqual([{ method: "DELETE", path: "/repos/acme-gh/app/issues/comments/9001" }]);
  });

  test("unlinked: nothing", async () => {
    const ctx = testContext();
    await deleteComment(ctx, "github", "9001");
    expect(ctx.ghost.calls).toEqual([]);
  });
});

describe("comment edge cases", () => {
  test("a create whose answer was lost finds our copy instead of posting twice", async () => {
    const body = withMarker("yo", "github", "x");
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/comments/9001": { id: 9001, body: "yo", user: { login: "x" } } },
      ghost: {
        "POST /repos/acme/app/issues/12/comments": () => {
          throw new TypeError("fetch failed");
        },
        "GET /repos/acme/app/issues/12/comments": [{ id: 302, node_id: ghostNodeId("IC", uuid), body, user: { login: "ghost-sync[bot]" } }],
      },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await syncComment(ctx, "github", 5, "9001");
    expect(await ctx.store.findLink(ctx.sync.id, "comment", "github", "9001")).toMatchObject({ ghostId: uuid, ghostRestId: "302" });
  });

  test("a Ghost comment missing from its issue's list is skipped and logged", async () => {
    const ctx = testContext({ ghost: { "GET /repos/acme/app/issues/12/comments": [] } });
    await syncComment(ctx, "ghost", 12, uuid);
    expect(ctx.store.activity).toEqual([expect.objectContaining({ direction: "github", error: expect.stringContaining("404") })]);
  });

  test("an edit on our copy goes back to the original without a marker", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/issues/comments/9001": { id: 9001, body: withMarker("fixed typo", "ghost", "bob"), user: { login: "ghost-sync[bot]" } } },
      ghost: { "PATCH /repos/acme/app/issues/comments/301": {} },
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "comment", ghostId: uuid, ghostRestId: "301", githubId: "9001" });
    await syncComment(ctx, "github", 5, "9001");
    expect(writes(ctx.ghost)[0]?.body).toEqual({ body: "fixed typo" });
  });

  test("a comment already deleted on the other side still unlinks", async () => {
    const ctx = testContext();
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "comment", ghostId: uuid, ghostRestId: "301", githubId: "9001" });
    await deleteComment(ctx, "ghost", uuid);
    expect(await ctx.store.findLink(ctx.sync.id, "comment", "ghost", uuid)).toBeNull();
  });
});
