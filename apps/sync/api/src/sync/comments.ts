import { other, SIDE_NAME, type Side } from "../side.ts";
import { readMarker } from "../format.ts";
import { repoPath, type SyncContext } from "./context.ts";
import { isHistory } from "./history.ts";
import { copiedBody, ghostKeyOfNodeId, syncIssue } from "./issues.ts";
import { createOnce, done, followBody, isNotFound, skipped } from "./write.ts";

export type Comment = { id: number; node_id: string; body: string | null; user: { login: string }; created_at?: string; updated_at?: string };

const threadLink = async (ctx: SyncContext, from: Side, number: number) =>
  (await ctx.store.findLink(ctx.sync.id, "issue", from, String(number))) ?? (await ctx.store.findLink(ctx.sync.id, "pull", from, String(number)));

/** The link of issue or pull request `number` on `from`, syncing the issue first when it has none yet; null when it could not be copied. */
async function counterpartOf(ctx: SyncContext, from: Side, number: number) {
  const link = await threadLink(ctx, from, number);
  if (link) return link;
  await syncIssue(ctx, from, number);
  return threadLink(ctx, from, number);
}

/** Ghost webhooks name a comment by UUID while its REST layer uses a numeric id, so a Ghost comment is found in its issue's list. */
async function readComment(ctx: SyncContext, from: Side, issueNumber: number, key: string) {
  if (from === "github") return ctx.rest.github.request<Comment>("GET", `${repoPath(ctx, "github")}/issues/comments/${key}`);
  for await (const comment of ctx.rest.ghost.paginate<Comment>(`${repoPath(ctx, "ghost")}/issues/${issueNumber}/comments`)) {
    if (ghostKeyOfNodeId(comment.node_id) === key) return comment;
  }
  return null;
}

/** Brings comment `key` (Ghost UUID or GitHub id) on issue or pull request `issueNumber` into agreement on the other side. `known` is the comment when the caller already read it, as reconcile does from a list. */
export async function syncComment(ctx: SyncContext, from: Side, issueNumber: number, key: string, known?: Comment) {
  const to = other(from);
  let source: Comment | null;
  try {
    source = known ?? (await readComment(ctx, from, issueNumber, key));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await skipped(ctx, to, "comment", `${SIDE_NAME[from]} comment on #${issueNumber} is gone`, error);
    return;
  }
  if (!source) {
    await skipped(ctx, to, "comment", `${SIDE_NAME[from]} comment on #${issueNumber} is gone`, "404 Not Found");
    return;
  }

  const link = await ctx.store.findLink(ctx.sync.id, "comment", from, key);
  const body = copiedBody(ctx, from, source.user.login, source.body);
  if (link) {
    const targetPath = `${repoPath(ctx, to)}/issues/comments/${to === "ghost" ? link.ghostRestId : link.githubId}`;
    await followBody(ctx, to, "comment", link, targetPath, source, body, `${source.user.login}'s comment on ${SIDE_NAME[from]} #${issueNumber}`);
    return;
  }
  if (source.user.login === ctx.bot[from]) return;

  const thread = await counterpartOf(ctx, from, issueNumber);
  if (!thread || isHistory(ctx, thread, source.created_at)) return;
  const commentsPath = `${repoPath(ctx, to)}/issues/${to === "ghost" ? thread.ghostId : thread.githubId}/comments`;
  const created = await createOnce<Comment>(ctx, to, commentsPath, { body }, async () => {
    for await (const comment of ctx.rest[to].paginate<Comment>(commentsPath)) {
      if (comment.user.login === ctx.bot[to] && comment.body === body) return comment;
    }
    return undefined;
  });
  const ids =
    to === "ghost"
      ? { ghostId: ghostKeyOfNodeId(created.node_id), ghostRestId: String(created.id), githubId: key }
      : { ghostId: key, ghostRestId: String(source.id), githubId: String(created.id) };
  await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "comment", ...ids, synced: { body: readMarker(source.body ?? "").body } });
  await done(ctx, to, "comment", `Copied ${source.user.login}'s comment on ${SIDE_NAME[from]} #${issueNumber}`);
}

export async function deleteComment(ctx: SyncContext, from: Side, key: string) {
  const link = await ctx.store.findLink(ctx.sync.id, "comment", from, key);
  if (!link) return;
  const to = other(from);
  const target = to === "ghost" ? link.ghostRestId : link.githubId;
  try {
    await ctx.rest[to].request("DELETE", `${repoPath(ctx, to)}/issues/comments/${target}`);
    await done(ctx, to, "comment", `Deleted a comment deleted on ${SIDE_NAME[from]}`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await ctx.store.deleteLink(ctx.sync.id, "comment", from, key);
}
