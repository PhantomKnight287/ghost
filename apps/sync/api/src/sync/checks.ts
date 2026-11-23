import { RestError } from "../rest.ts";
import { other, SIDE_NAME, type Side } from "../side.ts";
import { repoPath, type SyncContext } from "./context.ts";
import { createOnce, done, isNotFound, skipped } from "./write.ts";

type CheckRun = {
  id: number;
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  output?: { title: string | null; summary: string | null; text?: string | null } | null;
  html_url: string;
  details_url?: string | null;
  app: { slug: string } | null;
};

export const SYNC_CHECK_NAME = "Sync with GitHub";
/** The statuses any app may set; GitHub reserves the others (`waiting`, `pending`, `requested`) for Actions. */
const SETTABLE = ["queued", "in_progress", "completed"];

export async function commitExists(ctx: SyncContext, side: Side, sha: string) {
  try {
    await ctx.rest[side].request("GET", `${repoPath(ctx, side)}/commits/${sha}`);
    return true;
  } catch (error) {
    // GitHub answers 422 "No commit found for SHA" for a commit it has never seen.
    if (isNotFound(error) || (error instanceof RestError && error.status === 422)) return false;
    throw error;
  }
}

/** The run as written on the other side: same name, state and output, with its details link pointing at the original run. */
function copyOf(run: CheckRun) {
  const status = SETTABLE.includes(run.status) ? run.status : "queued";
  const fields: Record<string, unknown> = { name: run.name, head_sha: run.head_sha, status };
  if (status === "completed" && run.conclusion) fields.conclusion = run.conclusion;
  if (run.output?.title && run.output.summary) {
    fields.output = { title: run.output.title, summary: run.output.summary, ...(run.output.text ? { text: run.output.text } : {}) };
  }
  fields.details_url = run.html_url;
  return fields;
}

/** Copies check run `id` from `from` onto the same commit on the other side, or updates its copy. Our own runs are never copied, so a copy never echoes back. */
export async function syncCheckRun(ctx: SyncContext, from: Side, id: string) {
  const to = other(from);
  let run: CheckRun;
  try {
    run = await ctx.rest[from].request<CheckRun>("GET", `${repoPath(ctx, from)}/check-runs/${id}`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await skipped(ctx, to, "check_run", `${SIDE_NAME[from]} check run ${id} is gone`, error);
    return;
  }
  if (run.app?.slug === ctx.appSlug[from]) return;

  const fields = copyOf(run);
  const link = await ctx.store.findLink(ctx.sync.id, "check_run", from, id);
  if (link) {
    const targetPath = `${repoPath(ctx, to)}/check-runs/${to === "ghost" ? link.ghostId : link.githubId}`;
    // Copies only ever flow from the original run, so comparing with the copy is enough to tell whether anything changed.
    const current = copyOf({ ...(await ctx.rest[to].request<CheckRun>("GET", targetPath)), html_url: run.html_url });
    if (JSON.stringify(current) === JSON.stringify(fields)) return;
    // A run cannot move to another commit, so the update leaves `head_sha` out.
    const { head_sha: _, ...update } = fields;
    await ctx.rest[to].request("PATCH", targetPath, update);
    await done(ctx, to, "check_run", `Updated check run ${run.name} on ${run.head_sha.slice(0, 7)}: ${run.conclusion ?? run.status}`);
    return;
  }
  // The commit reaches the other side with its branch; reconcile copies the run once it has.
  if (!(await commitExists(ctx, to, run.head_sha))) return;

  const created = await createOnce<{ id: number }>(ctx, to, `${repoPath(ctx, to)}/check-runs`, fields, async () => {
    const listed = await ctx.rest[to].request<{ check_runs: CheckRun[] }>("GET", `${repoPath(ctx, to)}/commits/${run.head_sha}/check-runs?check_name=${encodeURIComponent(run.name)}`);
    return listed.check_runs.find((r) => r.app?.slug === ctx.appSlug[to] && r.details_url === run.html_url);
  });
  const ids = from === "ghost" ? { ghostId: id, githubId: String(created.id) } : { ghostId: String(created.id), githubId: id };
  await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "check_run", ghostRestId: ids.ghostId, ...ids });
  await done(ctx, to, "check_run", `Copied check run ${run.name} on ${run.head_sha.slice(0, 7)}`);
}

/** Opens the "Sync with GitHub" check on a Ghost commit and returns its run id. */
export async function startSyncCheck(ctx: SyncContext, sha: string) {
  const path = `${repoPath(ctx, "ghost")}/check-runs`;
  const created = await createOnce<{ id: number }>(ctx, "ghost", path, { name: SYNC_CHECK_NAME, head_sha: sha, status: "in_progress" }, async () => {
    const listed = await ctx.rest.ghost.request<{ check_runs: CheckRun[] }>("GET", `${repoPath(ctx, "ghost")}/commits/${sha}/check-runs?check_name=${encodeURIComponent(SYNC_CHECK_NAME)}`);
    return listed.check_runs.find((r) => r.app?.slug === ctx.appSlug.ghost && r.status === "in_progress");
  });
  return String(created.id);
}

export async function finishSyncCheck(ctx: SyncContext, runId: string, outcome: { ok: true } | { ok: false; reason: string }) {
  const output = outcome.ok
    ? { title: "In sync with GitHub", summary: "This commit's branches agree on Ghost and GitHub." }
    : { title: "Not in sync with GitHub", summary: outcome.reason };
  await ctx.rest.ghost.request("PATCH", `${repoPath(ctx, "ghost")}/check-runs/${runId}`, { status: "completed", conclusion: outcome.ok ? "success" : "failure", output });
  await done(ctx, "ghost", "check_run", outcome.ok ? `${SYNC_CHECK_NAME} passed` : `${SYNC_CHECK_NAME} failed: ${outcome.reason}`);
}
