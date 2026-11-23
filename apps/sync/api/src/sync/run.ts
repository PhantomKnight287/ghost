import type { SyncAction } from "./action.ts";
import { finishSyncCheck, startSyncCheck, syncCheckRun } from "./checks.ts";
import { deleteComment, syncComment } from "./comments.ts";
import { repoPath, type SyncContext } from "./context.ts";
import { deleteIssue, deleteLabelDefinition, syncIssue, syncLabelDefinition } from "./issues.ts";
import { syncPull } from "./pulls.ts";
import { syncRefs } from "./refs.ts";
import { deleteReviewComment, syncReview, syncReviewComment } from "./reviews.ts";
import { syncStatuses } from "./statuses.ts";

/** Opens "Sync with GitHub" on a Ghost commit, syncs every ref, and fails the check when a ref at that commit could not be synced. */
async function runSyncCheck(ctx: SyncContext, sha: string) {
  const runId = await startSyncCheck(ctx, sha);
  try {
    await syncRefs(ctx);
  } catch (error) {
    await finishSyncCheck(ctx, runId, { ok: false, reason: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  const stuck = (await ctx.store.listRefs(ctx.sync.id)).filter((ref) => ref.diverged && ref.diverged.ghost === sha);
  await finishSyncCheck(ctx, runId, stuck.length === 0 ? { ok: true } : { ok: false, reason: stuck.map((ref) => `${ref.name}: ${ref.diverged?.reason}`).join("\n") });
}

/** Copies every check run and status on `sha` from each side to the other; links make it a no-op for those already copied. */
export async function syncCommitChecks(ctx: SyncContext, sha: string) {
  for (const side of ["ghost", "github"] as const) {
    for await (const run of ctx.rest[side].paginate<{ id: number }>(`${repoPath(ctx, side)}/commits/${sha}/check-runs`)) {
      await syncCheckRun(ctx, side, String(run.id));
    }
    await syncStatuses(ctx, side, sha);
  }
}

/** The one place a queued action meets the `sync/*` function that carries it out. */
export async function runAction(ctx: SyncContext, action: SyncAction, reconcile: (ctx: SyncContext) => Promise<void>) {
  switch (action.kind) {
    case "refs":
      await syncRefs(ctx, action.refs);
      return;
    case "pull":
      await syncPull(ctx, action.from, action.number);
      return;
    case "review":
      await syncReview(ctx, action.from, action.pullNumber, action.key);
      return;
    case "review_comment":
      await (action.deleted ? deleteReviewComment(ctx, action.from, action.key) : syncReviewComment(ctx, action.from, action.pullNumber, action.key));
      return;
    case "issue":
      await (action.deleted ? deleteIssue(ctx, action.from, action.number) : syncIssue(ctx, action.from, action.number));
      return;
    case "comment":
      await (action.deleted ? deleteComment(ctx, action.from, action.key) : syncComment(ctx, action.from, action.issueNumber, action.key));
      return;
    case "label":
      await (action.deleted ? deleteLabelDefinition(ctx, action.from, action.name) : syncLabelDefinition(ctx, action.from, action.name, action.previousName));
      return;
    case "check_run":
      await syncCheckRun(ctx, action.from, action.id);
      return;
    case "status":
      await syncStatuses(ctx, action.from, action.sha);
      return;
    case "sync_check":
      await runSyncCheck(ctx, action.sha);
      return;
    case "rerun":
      await runSyncCheck(ctx, action.sha);
      await syncCommitChecks(ctx, action.sha);
      return;
    case "reconcile":
      await reconcile(ctx);
      return;
  }
}
