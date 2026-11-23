import type { Queue } from "./queue.ts";
import { type Rest, RestError } from "./rest.ts";
import { SIDE_NAME, type Side } from "./side.ts";
import type { Store, SyncRow } from "./store.ts";
import { syncCheckRun } from "./sync/checks.ts";
import { syncStatuses } from "./sync/statuses.ts";
import { type Comment, syncComment } from "./sync/comments.ts";
import { repoPath, type SyncContext } from "./sync/context.ts";
import { ghostKeyOfNodeId, syncIssue } from "./sync/issues.ts";
import { syncPull } from "./sync/pulls.ts";
import { syncRefs } from "./sync/refs.ts";
import { keyOf, type Review, type ReviewComment, syncReview, syncReviewComment } from "./sync/reviews.ts";

const SIDES: Side[] = ["ghost", "github"];
/** Lists ask for items changed since a little before the last run began, so clock differences between us and a host never hide an edit. Copying an item twice changes nothing. */
const SINCE_MARGIN_MS = 5 * 60_000;
/** Statuses a host answers when the installation or repository is gone, not just one item. */
const ACCESS_LOST = [401, 403, 404];

type Listed = { number: number; state: "open" | "closed"; pull_request?: unknown };
type PullHead = { state: "open" | "closed"; head: { sha: string } };

const all = async <T>(pages: AsyncGenerator<T>) => {
  const items: T[] = [];
  for await (const item of pages) items.push(item);
  return items;
};

/** Marks every RestError from `rest` with `side`, so a refusal deep inside an item still names the host that refused. */
function tagged(side: Side, rest: Rest): Rest {
  const mark = (error: unknown) => {
    if (error instanceof RestError) error.side ??= side;
    return error;
  };
  return {
    request: <T>(method: string, path: string, body?: unknown) =>
      rest.request<T>(method, path, body).catch((error) => {
        throw mark(error);
      }),
    paginate: async function* <T>(path: string) {
      try {
        yield* rest.paginate<T>(path);
      } catch (error) {
        throw mark(error);
      }
    },
    graphql: <T>(query: string, variables: Record<string, unknown>) =>
      rest.graphql<T>(query, variables).catch((error) => {
        throw mark(error);
      }),
  };
}

/** One issue or pull request and everything hanging off it: comments, and for a pull request its reviews, line comments and, while open, the check runs and commit statuses on its head. */
async function reconcileItem(ctx: SyncContext, side: Side, item: Listed) {
  const base = repoPath(ctx, side);
  if (item.pull_request) await syncPull(ctx, side, item.number);
  else await syncIssue(ctx, side, item.number);

  for (const comment of await all(ctx.rest[side].paginate<Comment>(`${base}/issues/${item.number}/comments`))) {
    await syncComment(ctx, side, item.number, side === "ghost" ? ghostKeyOfNodeId(comment.node_id) : String(comment.id), comment);
  }
  if (!item.pull_request) return;

  for (const review of await all(ctx.rest[side].paginate<Review>(`${base}/pulls/${item.number}/reviews`))) {
    await syncReview(ctx, side, item.number, keyOf(side, review), review);
  }
  const lineComments = await all(ctx.rest[side].paginate<ReviewComment>(`${base}/pulls/${item.number}/comments`));
  // Roots before replies, so every reply finds its thread.
  for (const comment of [...lineComments.filter((c) => !c.in_reply_to_id), ...lineComments.filter((c) => c.in_reply_to_id)]) {
    await syncReviewComment(ctx, side, item.number, keyOf(side, comment), lineComments);
  }
  if (item.state !== "open") return;

  // Runs and statuses on the default branch arrive by webhook; an open pull request's head is where reviews wait on checks.
  const { head } = await ctx.rest[side].request<PullHead>("GET", `${base}/pulls/${item.number}`);
  for (const runSide of SIDES) {
    for (const run of await all(ctx.rest[runSide].paginate<{ id: number }>(`${repoPath(ctx, runSide)}/commits/${head.sha}/check-runs`))) {
      await syncCheckRun(ctx, runSide, String(run.id));
    }
    await syncStatuses(ctx, runSide, head.sha);
  }
}

/**
 * Brings a whole sync into agreement: refs, then every issue and pull request changed on either side since the last run (all of them on the first). Interrupted runs restart from the top; links make every step idempotent.
 */
export async function reconcileSync(ctx: SyncContext, ownerCanAdmin: () => Promise<boolean>) {
  const { store, sync } = ctx;
  if (!(await ownerCanAdmin())) {
    await store.updateSync(sync.id, { status: "disconnected", disconnectReason: "owner lost access" });
    return;
  }
  const startedAt = new Date();
  const first = !sync.lastReconciledAt;
  if (first && sync.status !== "backfilling") await store.updateSync(sync.id, { status: "backfilling" });
  const run: SyncContext = { ...ctx, rest: { ghost: tagged("ghost", ctx.rest.ghost), github: tagged("github", ctx.rest.github) } };
  // Without backfill, the margin never reaches back past the sync's start, into history it was told to leave.
  const floor = sync.backfill ? 0 : sync.createdAt.getTime();
  const since = sync.lastReconciledAt ? `&since=${new Date(Math.max(sync.lastReconciledAt.getTime() - SINCE_MARGIN_MS, floor)).toISOString()}` : "";

  try {
    if (first && !sync.backfill) {
      // Nothing from before is copied; where each ref stood is all a later pass needs to tell history from new work.
      const refs = await ctx.git.fetchBoth(ctx.dir, await ctx.remote());
      await store.updateSync(sync.id, { status: "active", lastError: null, lastReconciledAt: sync.createdAt, refsAtSetup: { ghost: Object.fromEntries(refs.ghost), github: Object.fromEntries(refs.github) } });
      await store.addActivity({ syncId: sync.id, direction: null, kind: "reconcile", summary: "Sync started without history: only what happens from now on is copied", error: null });
      return;
    }
    const refs = await syncRefs(run);
    // A failed status write is dropped with its job; the default branch has no pull request to bring it back, so each pass copies its head's statuses.
    for (const side of SIDES) {
      const { default_branch } = await run.rest[side].request<{ default_branch: string }>("GET", repoPath(run, side));
      const head = refs[side].get(`refs/heads/${default_branch}`);
      if (head) await syncStatuses(run, side, head);
    }
    for (const side of SIDES) {
      for await (const item of run.rest[side].paginate<Listed>(`${repoPath(run, side)}/issues?state=all${since}`)) {
        try {
          await reconcileItem(run, side, item);
        } catch (error) {
          // A refused token is the installation's problem, not this item's.
          if (error instanceof RestError && error.status === 401) throw error;
          const message = error instanceof Error ? error.message : String(error);
          await store.addActivity({ syncId: sync.id, direction: null, kind: "reconcile", summary: `${SIDE_NAME[side]} #${item.number} not reconciled`, error: message });
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof RestError && error.side && ACCESS_LOST.includes(error.status)) {
      await store.updateSync(sync.id, { status: "disconnected", disconnectReason: `${SIDE_NAME[error.side]} refused Ghost Sync's access: ${message}` });
      return;
    }
    await store.updateSync(sync.id, { status: "error", lastError: message });
    await store.addActivity({ syncId: sync.id, direction: null, kind: "reconcile", summary: "Reconcile failed", error: message });
    return;
  }
  await store.updateSync(sync.id, { status: "active", lastError: null, lastReconciledAt: startedAt });
  if (first) await store.addActivity({ syncId: sync.id, direction: null, kind: "reconcile", summary: "First sync finished", error: null });
}

/** Whether the sync's owner is still an admin of both repositories, asked with the owner's own tokens; a side with no usable token (unlinked, or refresh failed) counts as lost. */
export async function ownerIsAdmin(userRest: Record<Side, Rest | null>, sync: Pick<SyncRow, "ghostFullName" | "githubFullName">) {
  for (const side of SIDES) {
    const rest = userRest[side];
    if (!rest) return false;
    try {
      const repo = await rest.request<{ permissions?: { admin?: boolean } }>("GET", `/repos/${side === "ghost" ? sync.ghostFullName : sync.githubFullName}`);
      if (repo.permissions?.admin !== true) return false;
    } catch (error) {
      if (error instanceof RestError && ACCESS_LOST.includes(error.status)) return false;
      throw error;
    }
  }
  return true;
}

/** Every `intervalSeconds`, queues a reconcile for each live sync, so it runs in that sync's queue and never beside a webhook job, then prunes old rows. */
export function startReconcileTimer({
  store,
  queue,
  intervalSeconds,
  onError = (error) => console.error("reconcile tick failed", error),
}: {
  store: Store;
  queue: Pick<Queue, "push">;
  intervalSeconds: number;
  onError?: (error: unknown) => void;
}) {
  const tick = async () => {
    for (const sync of await store.listSyncs({ status: ["active", "backfilling", "error"] })) await queue.push(sync.id, { kind: "reconcile" });
    await store.prune(new Date());
  };
  const timer = setInterval(() => tick().catch(onError), intervalSeconds * 1000);
  return { tick, stop: () => clearInterval(timer) };
}
