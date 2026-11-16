import { mergedText } from "../format.ts";
import { RestError } from "../rest.ts";
import { other, SIDE_NAME, type Side } from "../side.ts";
import { repoPath, type SyncContext } from "./context.ts";
import { copiedBody, ensureLabel, type Label } from "./issues.ts";
import { syncRefs } from "./refs.ts";
import { createOnce, isNotFound, skipped } from "./write.ts";

type Branch = { ref: string; sha: string; repo: { id: number | string } | null };
type Pull = {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  user: { login: string };
  labels?: Label[];
  head: Branch;
  base: Branch;
};

/** Where a Ghost fork pull request's head lives on GitHub, since GitHub cannot see the fork. */
const forkBranch = (number: number) => `ghost-pr/${number}`;

const isFork = (pull: Pull) => pull.head.repo === null || pull.head.repo.id !== pull.base.repo?.id;

/** Both sides hold the same commit for `ref` and it is not flagged. */
async function agreed(ctx: SyncContext, ref: string) {
  const row = await ctx.store.getRef(ctx.sync.id, ref);
  return Boolean(row?.baseSha) && !row?.diverged;
}

/**
 * Keeps `refs/heads/ghost-pr/<n>` on GitHub exactly at a Ghost fork pull request's head while it is open, and removes it once it closes. Returns whether GitHub now holds the head.
 */
async function syncForkHead(ctx: SyncContext, pull: Pull, githubRefs: Map<string, string>) {
  const ref = `refs/heads/${forkBranch(pull.number)}`;
  const remotes = await ctx.remote();
  const current = githubRefs.get(ref) ?? null;
  const wanted = pull.state === "open" ? await ctx.git.fetchPullHead(ctx.dir, remotes.ghost, pull.number) : null;
  if (wanted === current) return wanted !== null;
  const pushed = await ctx.git.pushRef(ctx.dir, remotes.github, ref, wanted, current);
  if (pushed.ok) return wanted !== null;
  await skipped(ctx, "github", "pull", `Could not update ${forkBranch(pull.number)} for Ghost pull request #${pull.number}`, `${pushed.reason}: ${pushed.message}`);
  return false;
}

/** Brings pull request `number` on `from` into agreement on the other side: branches first, then the pull request itself. */
export async function syncPull(ctx: SyncContext, from: Side, number: number) {
  const to = other(from);
  let source: Pull;
  try {
    source = await ctx.rest[from].request<Pull>("GET", `${repoPath(ctx, from)}/pulls/${number}`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await skipped(ctx, to, "pull", `${SIDE_NAME[from]} pull request #${number} is gone`, error);
    return;
  }

  const link = await ctx.store.findLink(ctx.sync.id, "pull", from, String(number));
  if (!link && source.user.login === ctx.bot[from]) return;
  const fork = isFork(source);
  if (fork && from === "github") {
    await ctx.store.addActivity({ syncId: ctx.sync.id, direction: "ghost", kind: "pull", summary: `GitHub pull request #${number} comes from a fork; forks on GitHub are not synced`, error: null });
    return;
  }

  const head = `refs/heads/${source.head.ref}`;
  const base = `refs/heads/${source.base.ref}`;
  const refs = await syncRefs(ctx, fork ? [base] : [head, base]);
  const headOnTarget = fork ? await syncForkHead(ctx, source, refs.github) : await agreed(ctx, head);
  const targetHead = fork ? forkBranch(number) : source.head.ref;

  if (!link) {
    if (!headOnTarget || !(await agreed(ctx, base))) {
      await skipped(ctx, to, "pull", `${SIDE_NAME[from]} pull request #${number} waits for ${targetHead} and ${source.base.ref} to agree on both sides`, "branches not synced");
      return;
    }
    await createPull(ctx, from, source, targetHead);
    return;
  }

  const counterpart = Number(to === "ghost" ? link.ghostId : link.githubId);
  const target = await ctx.rest[to].request<Pull>("GET", `${repoPath(ctx, to)}/pulls/${counterpart}`);

  // A merge reaches the other side through its branches; the copy only needs closing when the host did not see the merge itself.
  if (source.merged) {
    if (target.merged || target.state === "closed" || !(await agreed(ctx, base))) return;
    await ctx.rest[to].request("POST", `${repoPath(ctx, to)}/issues/${counterpart}/comments`, { body: mergedText(from) });
    await ctx.rest[to].request("PATCH", `${repoPath(ctx, to)}/pulls/${counterpart}`, { state: "closed" });
    return;
  }

  const patch: Record<string, unknown> = { title: source.title, body: copiedBody(ctx, from, source.user.login, source.body), state: source.state };
  if (target.base && target.base.ref !== source.base.ref) patch.base = source.base.ref;
  await ctx.rest[to].request("PATCH", `${repoPath(ctx, to)}/pulls/${counterpart}`, patch);
  if (source.draft !== target.draft) {
    const mutation = source.draft ? "convertPullRequestToDraft" : "markPullRequestReadyForReview";
    await ctx.rest[to].graphql(`mutation($id: ID!) { ${mutation}(input: { pullRequestId: $id }) { clientMutationId } }`, { id: target.node_id });
  }
  await syncLabels(ctx, to, counterpart, source.labels ?? [], target.labels ?? []);
}

async function createPull(ctx: SyncContext, from: Side, source: Pull, head: string) {
  const to = other(from);
  const fields = { title: source.title, body: copiedBody(ctx, from, source.user.login, source.body), head, base: source.base.ref, draft: source.draft };
  const pullsPath = `${repoPath(ctx, to)}/pulls`;
  let created: { number: number };
  try {
    created = await createOnce<{ number: number }>(ctx, to, pullsPath, fields, async () => {
      const owner = ctx.repo[to].owner;
      const open = await ctx.rest[to].request<Pull[]>("GET", `${pullsPath}?state=all&head=${encodeURIComponent(`${owner}:${head}`)}`);
      return open.find((pull) => pull.user.login === ctx.bot[to] && pull.title === fields.title && pull.body === fields.body);
    });
  } catch (error) {
    // 422 is the host refusing this pull request, such as "No commits between" for one merged before the first sync.
    if (!(error instanceof RestError) || error.status !== 422) throw error;
    await skipped(ctx, to, "pull", `${SIDE_NAME[from]} pull request #${source.number} was not copied`, error);
    return;
  }
  const ids = from === "ghost" ? { ghostId: String(source.number), githubId: String(created.number) } : { ghostId: String(created.number), githubId: String(source.number) };
  await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "pull", ghostRestId: null, ...ids });
  await syncLabels(ctx, to, created.number, source.labels ?? [], []);
  if (source.state === "closed") await ctx.rest[to].request("PATCH", `${pullsPath}/${created.number}`, { state: "closed" });
}

/** Sets the copy's labels to exactly the source's, creating missing label definitions first. */
async function syncLabels(ctx: SyncContext, to: Side, number: number, wanted: Label[], current: Label[]) {
  const names = wanted.map((label) => label.name);
  const same = names.length === current.length && current.every((label) => names.includes(label.name));
  if (same) return;
  for (const label of wanted) await ensureLabel(ctx, to, label);
  await ctx.rest[to].request("PATCH", `${repoPath(ctx, to)}/issues/${number}`, { labels: names });
}
