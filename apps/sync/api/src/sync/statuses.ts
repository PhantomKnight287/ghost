import { RestError } from "../rest.ts";
import { other, type Side } from "../side.ts";
import { commitExists } from "./checks.ts";
import { repoPath, type SyncContext } from "./context.ts";
import { done, isNotFound, skipped } from "./write.ts";

type Status = { context: string; state: string; description: string | null; target_url: string | null; creator: { login: string } | null };

/** GitHub treats contexts as case-insensitive, so `CI` and `ci` are one context. */
const contextKey = (status: Status) => status.context.toLowerCase();

/** The newest status of each context on `sha`, or none when the commit is not there. Both hosts list statuses newest first. */
async function latestByContext(ctx: SyncContext, side: Side, sha: string) {
  const latest = new Map<string, Status>();
  try {
    for await (const status of ctx.rest[side].paginate<Status>(`${repoPath(ctx, side)}/commits/${sha}/statuses`)) {
      if (!latest.has(contextKey(status))) latest.set(contextKey(status), status);
    }
  } catch (error) {
    // GitHub answers 422 "No commit found for SHA" for a commit it has never seen.
    if (isNotFound(error) || (error instanceof RestError && error.status === 422)) return new Map<string, Status>();
    throw error;
  }
  return latest;
}

/** Empty and missing are the same, since a copy leaves an empty description or link out. */
const same = (a: Status, b: Status) => a.state === b.state && (a.description || null) === (b.description || null) && (a.target_url || null) === (b.target_url || null);

/**
 * Posts the newest status of each context on commit `sha` from `from` onto the same commit on the other side, keeping its link so "Details" opens the deploy or build that reported it. Statuses are append-only and the newest per context wins, so a status needs no link: the other side's newest for that context says whether it is already copied.
 */
export async function syncStatuses(ctx: SyncContext, from: Side, sha: string) {
  const to = other(from);
  const source = [...(await latestByContext(ctx, from, sha)).values()].filter((status) => status.creator?.login !== ctx.bot[from]);
  if (source.length === 0) return;
  // The commit reaches the other side with its branch, and pushing it there copies its statuses.
  if (!(await commitExists(ctx, to, sha))) return;

  const target = await latestByContext(ctx, to, sha);
  for (const status of source) {
    const current = target.get(contextKey(status));
    // A context someone else reports on the other side is theirs; ours would only fight it.
    if (current && (current.creator?.login !== ctx.bot[to] || same(current, status))) continue;
    const body = { context: status.context, state: status.state, ...(status.description ? { description: status.description } : {}), ...(status.target_url ? { target_url: status.target_url } : {}) };
    try {
      await ctx.rest[to].request("POST", `${repoPath(ctx, to)}/statuses/${sha}`, body);
    } catch (error) {
      // Only a status the host finds invalid is this status's problem; anything else is the sync's.
      if (!(error instanceof RestError) || error.status !== 422) throw error;
      await skipped(ctx, to, "status", `Could not copy status ${status.context} on ${sha.slice(0, 7)}`, error);
      continue;
    }
    await done(ctx, to, "status", `Copied status ${status.context} on ${sha.slice(0, 7)}: ${status.state}`);
  }
}
