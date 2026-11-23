import { describe, expect, test } from "bun:test";
import { withMarker } from "../format.ts";
import { writes } from "../lib/fake-rest.ts";
import { ghostNodeId, testContext } from "../lib/test-context.ts";
import { syncComment } from "./comments.ts";
import { syncReview, syncReviewComment } from "./reviews.ts";

const paired = new Date("2026-11-20T00:00:00Z");
const before = "2026-11-19T00:00:00Z";
const after = "2026-11-21T00:00:00Z";
const comment = (created_at: string) => ({ id: 9001, node_id: "IC_9001", body: "yo", user: { login: "coderabbitai[bot]" }, created_at });
const lineComment = (created_at: string) => ({ id: 501, node_id: "PRRC_501", path: "src/a.ts", line: 3, side: "RIGHT", start_line: null, start_side: null, body: "nit", user: { login: "coderabbitai[bot]" }, commit_id: "h1", created_at });

describe("twins keep their own history from before they were paired", () => {
  const twins = async (ctx: ReturnType<typeof testContext>, kind: "issue" | "pull") => {
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind, ghostId: "3", ghostRestId: null, githubId: "8", pairedAt: paired });
  };

  test("a comment from before pairing is not copied; one from after is", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/issues/comments/9001": comment(before), "GET /repos/acme-gh/app/issues/comments/9002": { ...comment(after), id: 9002 } }, ghost: { "POST /repos/acme/app/issues/3/comments": { id: 302, node_id: ghostNodeId("IC", "c-uuid") } } });
    await twins(ctx, "issue");
    await syncComment(ctx, "github", 8, "9001");
    expect(writes(ctx.ghost)).toEqual([]);
    await syncComment(ctx, "github", 8, "9002");
    expect(writes(ctx.ghost).map((c) => c.path)).toEqual(["/repos/acme/app/issues/3/comments"]);
  });

  test("a review from before pairing is not copied", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/pulls/8/reviews/77": { id: 77, state: "APPROVED", body: "LGTM", user: { login: "coderabbitai[bot]" }, commit_id: "h1", submitted_at: before }, "GET /repos/acme-gh/app/pulls/8/reviews/77/comments": [] } });
    await twins(ctx, "pull");
    await syncReview(ctx, "github", 8, "77");
    expect(writes(ctx.ghost)).toEqual([]);
  });

  test("a line comment from before pairing is not copied", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/pulls/comments/501": lineComment(before) } });
    await twins(ctx, "pull");
    await syncReviewComment(ctx, "github", 8, "501");
    expect(writes(ctx.ghost)).toEqual([]);
  });

  test("a new reply in a thread from before pairing goes on the same line as a comment of its own", async () => {
    const reply = { ...lineComment(after), id: 502, node_id: "PRRC_502", body: "fixed", in_reply_to_id: 501 };
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/pulls/comments/502": reply, "GET /repos/acme-gh/app/pulls/comments/501": lineComment(before) },
      ghost: { "POST /repos/acme/app/pulls/3/comments": { id: 601, node_id: ghostNodeId("PRRC", "r-uuid") } },
    });
    await twins(ctx, "pull");
    await syncReviewComment(ctx, "github", 8, "502");
    expect(writes(ctx.ghost)).toEqual([{ method: "POST", path: "/repos/acme/app/pulls/3/comments", body: { commit_id: "h1", path: "src/a.ts", line: 3, side: "RIGHT", body: withMarker("fixed", "github", "coderabbitai[bot]") } }]);
  });

  test("items copied rather than paired bring their whole history", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/issues/comments/9001": comment(before) }, ghost: { "POST /repos/acme/app/issues/3/comments": { id: 302, node_id: ghostNodeId("IC", "c-uuid") } } });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "3", ghostRestId: null, githubId: "8" });
    await syncComment(ctx, "github", 8, "9001");
    expect(writes(ctx.ghost)).toHaveLength(1);
  });
});

describe("a sync started without backfill copies nothing from before it began", () => {
  const started = { backfill: false, createdAt: paired };

  test("a comment from before the sync started is not copied, even on an issue copied since", async () => {
    const ctx = testContext({ sync: started, github: { "GET /repos/acme-gh/app/issues/comments/9001": comment(before) } });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "3", ghostRestId: null, githubId: "8" });
    await syncComment(ctx, "github", 8, "9001");
    expect(writes(ctx.ghost)).toEqual([]);
  });

  test("a comment made after it started is copied", async () => {
    const ctx = testContext({ sync: started, github: { "GET /repos/acme-gh/app/issues/comments/9001": comment(after) }, ghost: { "POST /repos/acme/app/issues/3/comments": { id: 302, node_id: ghostNodeId("IC", "c-uuid") } } });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostId: "3", ghostRestId: null, githubId: "8" });
    await syncComment(ctx, "github", 8, "9001");
    expect(writes(ctx.ghost)).toHaveLength(1);
  });
});
