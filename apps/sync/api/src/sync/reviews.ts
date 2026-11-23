import { readMarker, verdictText, withMarker } from "../format.ts";
import { RestError } from "../rest.ts";
import { other, SIDE_NAME, type Side } from "../side.ts";
import { repoPath, type SyncContext } from "./context.ts";
import { isHistory } from "./history.ts";
import { copiedBody, ghostKeyOfNodeId } from "./issues.ts";
import { syncPull } from "./pulls.ts";
import { createOnce, done, followBody, isNotFound, skipped } from "./write.ts";

export type Review = { id: number; node_id: string; state: string; body: string | null; user: { login: string }; commit_id: string; submitted_at?: string };
export type ReviewComment = {
  id: number;
  node_id: string;
  path: string;
  line: number | null;
  side: string | null;
  start_line: number | null;
  start_side: string | null;
  body: string | null;
  user: { login: string };
  commit_id: string;
  in_reply_to_id?: number | null;
  created_at?: string;
  updated_at?: string;
};

const VERDICTS = ["APPROVED", "CHANGES_REQUESTED", "COMMENTED"] as const;

async function all<T>(pages: AsyncGenerator<T>) {
  const items: T[] = [];
  for await (const item of pages) items.push(item);
  return items;
}

/** The webhook key of a REST item: Ghost's UUID from `node_id`, GitHub's numeric id. */
export const keyOf = (side: Side, item: { id: number; node_id: string }) => (side === "ghost" ? ghostKeyOfNodeId(item.node_id) : String(item.id));

const linkIds = (from: Side, key: string, source: { id: number }, to: Side, created: { id: number; node_id: string }) =>
  to === "ghost" ? { ghostId: ghostKeyOfNodeId(created.node_id), ghostRestId: String(created.id), githubId: key } : { ghostId: key, ghostRestId: String(source.id), githubId: String(created.id) };

/** The REST id of a linked item on `side`. */
const restIdOn = (side: Side, link: { ghostRestId: string | null; githubId: string }) => (side === "ghost" ? link.ghostRestId : link.githubId);

/** A comment's place in the diff. GitHub refuses explicit nulls for a single-line comment's range. */
function position(comment: ReviewComment) {
  const place: Record<string, unknown> = { path: comment.path, line: comment.line, side: comment.side };
  if (comment.start_line !== null) place.start_line = comment.start_line;
  if (comment.start_side !== null) place.start_side = comment.start_side;
  return place;
}

/** The pull request's link, syncing the pull request first when it has none yet; null when it could not be copied. */
async function counterpartPull(ctx: SyncContext, from: Side, pullNumber: number) {
  const find = () => ctx.store.findLink(ctx.sync.id, "pull", from, String(pullNumber));
  const link = await find();
  if (link) return link;
  await syncPull(ctx, from, pullNumber);
  return find();
}

const numberOn = (side: Side, link: { ghostId: string; githubId: string }) => Number(side === "ghost" ? link.ghostId : link.githubId);

/** Ghost webhooks name reviews by UUID while its REST layer uses numeric ids, so a Ghost review is found in its pull request's list. */
async function readReview(ctx: SyncContext, from: Side, pullNumber: number, key: string) {
  const pulls = `${repoPath(ctx, from)}/pulls/${pullNumber}`;
  if (from === "github") return ctx.rest.github.request<Review>("GET", `${pulls}/reviews/${key}`);
  for await (const review of ctx.rest.ghost.paginate<Review>(`${pulls}/reviews`)) if (ghostKeyOfNodeId(review.node_id) === key) return review;
  throw new RestError(404, { message: `Ghost review ${key} not found` });
}

function fromList(comments: ReviewComment[], from: Side, key: string) {
  const comment = comments.find((c) => keyOf(from, c) === key);
  if (!comment) throw new RestError(404, { message: `${SIDE_NAME[from]} review comment ${key} not found` });
  return { comment, siblings: comments };
}

async function readReviewComment(ctx: SyncContext, from: Side, pullNumber: number, key: string) {
  if (from === "github") return { comment: await ctx.rest.github.request<ReviewComment>("GET", `${repoPath(ctx, "github")}/pulls/comments/${key}`), siblings: null };
  const siblings = await all(ctx.rest.ghost.paginate<ReviewComment>(`${repoPath(ctx, "ghost")}/pulls/${pullNumber}/comments`));
  const comment = siblings.find((c) => ghostKeyOfNodeId(c.node_id) === key);
  if (!comment) throw new RestError(404, { message: `Ghost review comment ${key} not found` });
  return { comment, siblings };
}

/**
 * Copies review `key` (Ghost UUID or GitHub id) as a comment-only review stating its verdict: Ghost Sync never approves or blocks on anyone's behalf. Line comments already copied on their own are left out, so the review's and its comments' webhooks may arrive in either order.
 */
export async function syncReview(ctx: SyncContext, from: Side, pullNumber: number, key: string, known?: Review) {
  const to = other(from);
  let review: Review;
  try {
    review = known ?? (await readReview(ctx, from, pullNumber, key));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await skipped(ctx, to, "review", `${SIDE_NAME[from]} review on #${pullNumber} is gone`, error);
    return;
  }
  // Ghost has no endpoint to edit a review, so a copied review stays as first written.
  if (review.user.login === ctx.bot[from] || (await ctx.store.findLink(ctx.sync.id, "review", from, key))) return;

  const comments = await all(ctx.rest[from].paginate<ReviewComment>(`${repoPath(ctx, from)}/pulls/${pullNumber}/reviews/${review.id}/comments`));
  const roots: ReviewComment[] = [];
  for (const comment of comments) {
    if (comment.in_reply_to_id || (await ctx.store.findLink(ctx.sync.id, "review_comment", from, keyOf(from, comment)))) continue;
    roots.push(comment);
  }
  const verdict = VERDICTS.find((v) => v === review.state) ?? "COMMENTED";
  // GitHub files every lone line comment as an empty COMMENTED review; once its comments are copied there is nothing left to say.
  if (verdict === "COMMENTED" && !review.body && roots.length === 0) return;

  const pull = await counterpartPull(ctx, from, pullNumber);
  if (!pull || isHistory(ctx, pull, review.submitted_at)) return;
  const counterpart = numberOn(to, pull);
  const author = review.user.login;
  const text = review.body ? `${verdictText(verdict, from, author)}\n\n${review.body}` : verdictText(verdict, from, author);
  const payload = {
    event: "COMMENT",
    commit_id: review.commit_id,
    body: withMarker(text, from, author),
    comments: roots.map((c) => ({ ...position(c), body: withMarker(c.body ?? "", from, c.user.login) })),
  };
  const reviewsPath = `${repoPath(ctx, to)}/pulls/${counterpart}/reviews`;
  const findCreated = async () => {
    for await (const r of ctx.rest[to].paginate<Review>(reviewsPath)) if (r.user.login === ctx.bot[to] && r.body === payload.body) return r;
    return undefined;
  };

  let created: Review;
  let separately: ReviewComment[] = [];
  try {
    created = await createOnce<Review>(ctx, to, reviewsPath, payload, findCreated);
  } catch (error) {
    // One comment on a line the copy's diff lacks fails the whole review; post the verdict alone and each comment on its own, so only that one is skipped.
    if (!(error instanceof RestError) || error.status !== 422 || payload.comments.length === 0) throw error;
    created = await createOnce<Review>(ctx, to, reviewsPath, { ...payload, comments: [] }, findCreated);
    separately = roots;
  }
  await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "review", ...linkIds(from, key, review, to, created) });
  await done(ctx, to, "review", `Copied ${author}'s review on ${SIDE_NAME[from]} #${pullNumber}`);

  if (separately.length === 0 && roots.length > 0) {
    const unused = await all(ctx.rest[to].paginate<ReviewComment>(`${reviewsPath}/${created.id}/comments`));
    for (const root of roots) {
      const index = unused.findIndex((c) => c.path === root.path && c.line === root.line);
      const [copy] = index === -1 ? [] : unused.splice(index, 1);
      if (copy) await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "review_comment", ...linkIds(from, keyOf(from, root), root, to, copy) });
    }
  }
  for (const comment of [...separately, ...comments.filter((c) => c.in_reply_to_id)]) await syncReviewComment(ctx, from, pullNumber, keyOf(from, comment));
}

/** Brings review comment `key` into agreement: an edit updates the copy, a reply joins the matching thread, a lone comment keeps its place in the diff. `known` is the pull request's comments when the caller already listed them. */
export async function syncReviewComment(ctx: SyncContext, from: Side, pullNumber: number, key: string, known?: ReviewComment[]): Promise<void> {
  const to = other(from);
  let read: Awaited<ReturnType<typeof readReviewComment>>;
  try {
    read = known ? fromList(known, from, key) : await readReviewComment(ctx, from, pullNumber, key);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await skipped(ctx, to, "review_comment", `${SIDE_NAME[from]} review comment on #${pullNumber} is gone`, error);
    return;
  }
  const { comment, siblings } = read;
  const body = copiedBody(ctx, from, comment.user.login, comment.body);
  const link = await ctx.store.findLink(ctx.sync.id, "review_comment", from, key);
  if (link) {
    const targetPath = `${repoPath(ctx, to)}/pulls/comments/${restIdOn(to, link)}`;
    await followBody(ctx, to, "review_comment", link, targetPath, comment, body, `${comment.user.login}'s comment on ${comment.path} in ${SIDE_NAME[from]} #${pullNumber}`);
    return;
  }
  if (comment.user.login === ctx.bot[from]) return;

  const pull = await counterpartPull(ctx, from, pullNumber);
  if (!pull || isHistory(ctx, pull, comment.created_at)) return;
  const counterpart = numberOn(to, pull);

  let payload: Record<string, unknown> = { commit_id: comment.commit_id, ...position(comment), body };
  if (comment.in_reply_to_id) {
    const parent = siblings?.find((c) => c.id === comment.in_reply_to_id);
    const parentKey = from === "github" ? String(comment.in_reply_to_id) : parent && ghostKeyOfNodeId(parent.node_id);
    if (!parentKey) return skipped(ctx, to, "review_comment", `The thread of ${SIDE_NAME[from]} review comment on #${pullNumber} is gone`, "404 Not Found");
    let parentLink = await ctx.store.findLink(ctx.sync.id, "review_comment", from, parentKey);
    if (!parentLink) {
      await syncReviewComment(ctx, from, pullNumber, parentKey);
      parentLink = await ctx.store.findLink(ctx.sync.id, "review_comment", from, parentKey);
    }
    if (!parentLink) return skipped(ctx, to, "review_comment", `The thread of ${SIDE_NAME[from]} review comment on #${pullNumber} was not copied`, "parent not synced");
    payload = { body, in_reply_to: Number(restIdOn(to, parentLink)) };
  }

  const commentsPath = `${repoPath(ctx, to)}/pulls/${counterpart}/comments`;
  try {
    const created = await createOnce<ReviewComment>(ctx, to, commentsPath, payload, async () => {
      for await (const c of ctx.rest[to].paginate<ReviewComment>(commentsPath)) if (c.user.login === ctx.bot[to] && c.body === body) return c;
      return undefined;
    });
    await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "review_comment", ...linkIds(from, key, comment, to, created), synced: { body: readMarker(comment.body ?? "").body } });
    await done(ctx, to, "review_comment", `Copied ${comment.user.login}'s comment on ${comment.path} in ${SIDE_NAME[from]} #${pullNumber}`);
  } catch (error) {
    // 422: the line is not part of the copy's diff, for instance after a force-push on one side.
    if (!(error instanceof RestError) || error.status !== 422) throw error;
    await skipped(ctx, to, "review_comment", `${SIDE_NAME[from]} review comment on ${comment.path} was not copied`, error);
  }
}

export async function deleteReviewComment(ctx: SyncContext, from: Side, key: string) {
  const link = await ctx.store.findLink(ctx.sync.id, "review_comment", from, key);
  if (!link) return;
  const to = other(from);
  try {
    await ctx.rest[to].request("DELETE", `${repoPath(ctx, to)}/pulls/comments/${restIdOn(to, link)}`);
    await done(ctx, to, "review_comment", `Deleted a review comment deleted on ${SIDE_NAME[from]}`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await ctx.store.deleteLink(ctx.sync.id, "review_comment", from, key);
}
