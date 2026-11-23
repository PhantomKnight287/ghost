import type { Link } from "../store.ts";
import type { SyncContext } from "./context.ts";

/**
 * Whether a comment or review written at `writtenAt` on the thread `parent` predates what this sync copies. Twins a person kept by hand keep their own history from before they were paired, and a sync started without backfill copies nothing from before it began. A host that gives no time is copied, so nothing is dropped on a guess.
 */
export function isHistory(ctx: SyncContext, parent: Link | null, writtenAt: string | undefined) {
  if (!writtenAt) return false;
  const starts = [parent?.pairedAt, ctx.sync.backfill ? null : ctx.sync.createdAt].filter((start): start is Date => start instanceof Date);
  return starts.some((start) => Date.parse(writtenAt) < start.getTime());
}
