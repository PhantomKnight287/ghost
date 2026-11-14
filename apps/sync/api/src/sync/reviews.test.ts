import { describe, expect, test } from "bun:test";
import { withMarker } from "../format.ts";
import { fakeGit } from "../lib/fake-git.ts";
import { writes } from "../lib/fake-rest.ts";
import { ghostNodeId, testContext } from "../lib/test-context.ts";
import { RestError } from "../rest.ts";
import { deleteReviewComment, syncReview, syncReviewComment } from "./reviews.ts";

const reviewUuid = "11111111-1111-4111-8111-111111111111";
const commentUuid = "22222222-2222-4222-8222-222222222222";
const bot = { login: "coderabbitai[bot]" };
const lineComment = { id: 501, path: "src/a.ts", line: 3, side: "RIGHT", start_line: null, start_side: null, body: "nit", user: bot, commit_id: "h1", pull_request_review_id: 77 };

async function linkedPull(ctx: ReturnType<typeof testContext>) {
  await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "pull", ghostId: "3", ghostRestId: null, githubId: "8" });
}

describe("syncReview", () => {
  test("an approval from GitHub lands on Ghost as a comment-only review stating the verdict, with its line comments", async () => {
    const ctx = testContext({
      github: {
        "GET /repos/acme-gh/app/pulls/8/reviews/77": { id: 77, state: "APPROVED", body: "LGTM", user: bot, commit_id: "h1" },
        "GET /repos/acme-gh/app/pulls/8/reviews/77/comments": [lineComment],
      },
      ghost: {
        "POST /repos/acme/app/pulls/3/reviews": { id: 900, node_id: ghostNodeId("PRR", reviewUuid) },
        "GET /repos/acme/app/pulls/3/reviews/900/comments": [{ id: 601, node_id: ghostNodeId("PRRC", commentUuid), path: "src/a.ts", line: 3 }],
      },
    });
    await linkedPull(ctx);
    await syncReview(ctx, "github", 8, "77");
    const post = writes(ctx.ghost)[0];
    expect(post?.path).toBe("/repos/acme/app/pulls/3/reviews");
    expect(post?.body).toEqual({
      event: "COMMENT",
      commit_id: "h1",
      body: withMarker("Approved on GitHub by @coderabbitai[bot]\n\nLGTM", "github", "coderabbitai[bot]"),
      comments: [{ path: "src/a.ts", line: 3, side: "RIGHT", body: withMarker("nit", "github", "coderabbitai[bot]") }],
    });
    expect(await ctx.store.findLink(ctx.sync.id, "review", "github", "77")).toMatchObject({ ghostId: reviewUuid, ghostRestId: "900" });
    expect(await ctx.store.findLink(ctx.sync.id, "review_comment", "github", "501")).toMatchObject({ ghostId: commentUuid, ghostRestId: "601" });
  });

  test("a multi-line comment keeps its range", async () => {
    const ctx = testContext({
      github: {
        "GET /repos/acme-gh/app/pulls/8/reviews/77": { id: 77, state: "COMMENTED", body: "", user: bot, commit_id: "h1" },
        "GET /repos/acme-gh/app/pulls/8/reviews/77/comments": [{ ...lineComment, start_line: 1, start_side: "RIGHT" }],
      },
      ghost: { "POST /repos/acme/app/pulls/3/reviews": { id: 900, node_id: ghostNodeId("PRR", reviewUuid) }, "GET /repos/acme/app/pulls/3/reviews/900/comments": [] },
    });
    await linkedPull(ctx);
    await syncReview(ctx, "github", 8, "77");
    const body = writes(ctx.ghost)[0]?.body as { body: string; comments: unknown[] };
    expect(body.body).toBe(withMarker("Commented on GitHub by @coderabbitai[bot]", "github", "coderabbitai[bot]"));
    expect(body.comments[0]).toMatchObject({ start_line: 1, start_side: "RIGHT", line: 3 });
  });

  test("a Ghost review found from its webhook UUID goes to GitHub, never as an approval or a block", async () => {
    const ctx = testContext({
      ghost: {
        "GET /repos/acme/app/pulls/3/reviews": [{ id: 900, node_id: ghostNodeId("PRR", reviewUuid), state: "CHANGES_REQUESTED", body: "fix", user: { login: "bob" }, commit_id: "h1" }],
        "GET /repos/acme/app/pulls/3/reviews/900/comments": [],
      },
      github: { "POST /repos/acme-gh/app/pulls/8/reviews": { id: 77 }, "GET /repos/acme-gh/app/pulls/8/reviews/77/comments": [] },
    });
    await linkedPull(ctx);
    await syncReview(ctx, "ghost", 3, reviewUuid);
    expect(writes(ctx.github)[0]?.body).toMatchObject({ event: "COMMENT", body: withMarker("Changes requested on Ghost by @bob\n\nfix", "ghost", "bob") });
    expect(await ctx.store.findLink(ctx.sync.id, "review", "ghost", reviewUuid)).toMatchObject({ githubId: "77", ghostRestId: "900" });
  });

  test("an already linked review is not posted twice", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/pulls/8/reviews/77": { id: 77, state: "APPROVED", body: "", user: bot, commit_id: "h1" } } });
    await linkedPull(ctx);
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "review", ghostId: reviewUuid, ghostRestId: "900", githubId: "77" });
    await syncReview(ctx, "github", 8, "77");
    expect(writes(ctx.ghost)).toEqual([]);
  });

  test("a review by our bot is left alone", async () => {
    const ctx = testContext({ github: { "GET /repos/acme-gh/app/pulls/8/reviews/77": { id: 77, state: "COMMENTED", body: "x", user: { login: "ghost-sync[bot]" }, commit_id: "h1" } } });
    await linkedPull(ctx);
    await syncReview(ctx, "github", 8, "77");
    expect(writes(ctx.ghost)).toEqual([]);
  });

  test("an unlinked pull request is synced first", async () => {
    const pull = { number: 8, title: "T", body: "", state: "open", draft: false, merged: false, user: { login: "alice" }, labels: [], head: { ref: "feat", sha: "h1", repo: { id: 4242 } }, base: { ref: "main", sha: "m1", repo: { id: 4242 } } };
    const ctx = testContext({
      git: fakeGit({ github: { "refs/heads/feat": "h1", "refs/heads/main": "m1" }, ghost: { "refs/heads/main": "m1" } }),
      github: {
        "GET /repos/acme-gh/app/pulls/8": pull,
        "GET /repos/acme-gh/app/pulls/8/reviews/77": { id: 77, state: "COMMENTED", body: "hm", user: bot, commit_id: "h1" },
        "GET /repos/acme-gh/app/pulls/8/reviews/77/comments": [],
      },
      ghost: { "POST /repos/acme/app/pulls": { number: 3 }, "POST /repos/acme/app/pulls/3/reviews": { id: 900, node_id: ghostNodeId("PRR", reviewUuid) }, "GET /repos/acme/app/pulls/3/reviews/900/comments": [] },
    });
    await ctx.store.setBase(ctx.sync.id, "refs/heads/main", "m1");
    await syncReview(ctx, "github", 8, "77");
    expect(writes(ctx.ghost).map((c) => c.path)).toEqual(["/repos/acme/app/pulls", "/repos/acme/app/pulls/3/reviews"]);
  });
});

describe("syncReviewComment", () => {
  test("a reply lands in the matching thread", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/pulls/comments/502": { ...lineComment, id: 502, in_reply_to_id: 501, body: "why?", user: { login: "alice" } } },
      ghost: { "POST /repos/acme/app/pulls/3/comments": { id: 602, node_id: ghostNodeId("PRRC", "reply-uuid") } },
    });
    await linkedPull(ctx);
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "review_comment", ghostId: commentUuid, ghostRestId: "601", githubId: "501" });
    await syncReviewComment(ctx, "github", 8, "502");
    expect(writes(ctx.ghost)).toEqual([{ method: "POST", path: "/repos/acme/app/pulls/3/comments", body: { body: withMarker("why?", "github", "alice"), in_reply_to: 601 } }]);
    expect(await ctx.store.findLink(ctx.sync.id, "review_comment", "github", "502")).toMatchObject({ ghostId: "reply-uuid", ghostRestId: "602" });
  });

  test("a lone line comment keeps its place in the diff", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/pulls/comments/501": lineComment },
      ghost: { "POST /repos/acme/app/pulls/3/comments": { id: 601, node_id: ghostNodeId("PRRC", commentUuid) } },
    });
    await linkedPull(ctx);
    await syncReviewComment(ctx, "github", 8, "501");
    expect(writes(ctx.ghost)[0]?.body).toMatchObject({ commit_id: "h1", path: "src/a.ts", line: 3, side: "RIGHT", body: withMarker("nit", "github", "coderabbitai[bot]") });
  });

  test("a Ghost line comment is found from its webhook UUID", async () => {
    const ctx = testContext({
      ghost: { "GET /repos/acme/app/pulls/3/comments": [{ ...lineComment, id: 601, node_id: ghostNodeId("PRRC", commentUuid), user: { login: "bob" } }] },
      github: { "POST /repos/acme-gh/app/pulls/8/comments": { id: 501 } },
    });
    await linkedPull(ctx);
    await syncReviewComment(ctx, "ghost", 3, commentUuid);
    expect(writes(ctx.github)[0]?.body).toMatchObject({ path: "src/a.ts", line: 3, body: withMarker("nit", "ghost", "bob") });
    expect(await ctx.store.findLink(ctx.sync.id, "review_comment", "ghost", commentUuid)).toMatchObject({ githubId: "501", ghostRestId: "601" });
  });

  test("linked: an edit updates the copy", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/pulls/comments/501": { ...lineComment, body: "nit, edited" } },
      ghost: { "PATCH /repos/acme/app/pulls/comments/601": {} },
    });
    await linkedPull(ctx);
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "review_comment", ghostId: commentUuid, ghostRestId: "601", githubId: "501" });
    await syncReviewComment(ctx, "github", 8, "501");
    expect(writes(ctx.ghost)).toEqual([{ method: "PATCH", path: "/repos/acme/app/pulls/comments/601", body: { body: withMarker("nit, edited", "github", "coderabbitai[bot]") } }]);
  });

  test("a line no longer in the diff is skipped and logged", async () => {
    const ctx = testContext({
      github: { "GET /repos/acme-gh/app/pulls/comments/501": lineComment },
      ghost: {
        "POST /repos/acme/app/pulls/3/comments": () => {
          throw new RestError(422, { message: "line must be part of the diff" });
        },
      },
    });
    await linkedPull(ctx);
    await syncReviewComment(ctx, "github", 8, "501");
    expect(ctx.store.activity).toEqual([expect.objectContaining({ error: expect.stringContaining("part of the diff") })]);
  });
});

describe("deleteReviewComment", () => {
  test("deletes the copy and unlinks", async () => {
    const ctx = testContext({ ghost: { "DELETE /repos/acme/app/pulls/comments/601": undefined } });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "review_comment", ghostId: commentUuid, ghostRestId: "601", githubId: "501" });
    await deleteReviewComment(ctx, "github", "501");
    expect(writes(ctx.ghost)).toEqual([{ method: "DELETE", path: "/repos/acme/app/pulls/comments/601" }]);
    expect(await ctx.store.findLink(ctx.sync.id, "review_comment", "github", "501")).toBeNull();
  });

  test("unlinked: nothing", async () => {
    const ctx = testContext();
    await deleteReviewComment(ctx, "ghost", commentUuid);
    expect(ctx.github.calls).toEqual([]);
  });
});
