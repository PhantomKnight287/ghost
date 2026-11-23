import type { Remote } from "../git.ts";
import { other, type Side } from "../side.ts";
import type { RefFlag } from "../store.ts";
import type { SyncContext } from "./context.ts";
import { syncStatuses } from "./statuses.ts";

export type RefState = { base: string | null; ghost: string | null; github: string | null; ghostHasGithub: boolean; githubHasGhost: boolean };
export type RefAction = { kind: "none" } | { kind: "record"; sha: string | null } | { kind: "copy"; to: Side; sha: string | null; expected: string | null } | { kind: "diverged" };

/** The three-way comparison against the last synced base. A copy only ever replaces a target that still equals the base, or fast-forwards it. */
export function decideRef({ base, ghost, github, ghostHasGithub, githubHasGhost }: RefState): RefAction {
  if (ghost === github) return ghost === base ? { kind: "none" } : { kind: "record", sha: ghost };
  if (ghost === base) return { kind: "copy", to: "ghost", sha: github, expected: ghost };
  if (github === base) return { kind: "copy", to: "github", sha: ghost, expected: github };
  if (ghost !== null && github !== null) {
    if (githubHasGhost) return { kind: "copy", to: "ghost", sha: github, expected: ghost };
    if (ghostHasGithub) return { kind: "copy", to: "github", sha: ghost, expected: github };
  }
  return { kind: "diverged" };
}

const short = (sha: string | null) => sha?.slice(0, 7) ?? "deleted";

/** Brings every branch and tag (or only `only`) into agreement. `ghost-pr/*` heads belong to pull requests. Returns each side's refs as last fetched. */
export async function syncRefs(ctx: SyncContext, only?: string[]) {
  const remotes = await ctx.remote();
  let fetched = await ctx.git.fetchBoth(ctx.dir, remotes);
  const stored = await ctx.store.listRefs(ctx.sync.id);
  const names = new Set([...fetched.ghost.keys(), ...fetched.github.keys(), ...stored.map((r) => r.name)]);

  const setup = ctx.sync.refsAtSetup;
  for (const name of names) {
    if (only && !only.includes(name)) continue;
    // Without backfill, a ref no one has moved since the sync started is history; a webhook naming it still syncs it.
    if (!only && setup && !stored.some((r) => r.name === name) && fetched.ghost.get(name) === setup.ghost[name] && fetched.github.get(name) === setup.github[name]) continue;
    if (name.startsWith("refs/heads/ghost-pr/")) continue;
    for (let attempt = 1; ; attempt++) {
      const outcome = await syncRef(ctx, remotes, name, fetched.ghost.get(name) ?? null, fetched.github.get(name) ?? null);
      // A lease failure means a person pushed between our fetch and our push: compare again once against what they pushed.
      if (outcome !== "lease" || attempt === 2) break;
      fetched = await ctx.git.fetchBoth(ctx.dir, remotes);
    }
  }
  return fetched;
}

async function syncRef(ctx: SyncContext, remotes: Record<Side, Remote>, name: string, ghost: string | null, github: string | null) {
  const row = await ctx.store.getRef(ctx.sync.id, name);
  // A ref both sides agreed on when a sync started without backfill has that commit as its base until one is recorded.
  const setup = ctx.sync.refsAtSetup;
  const setupBase = setup && setup.ghost[name] === setup.github[name] ? (setup.ghost[name] ?? null) : null;
  const both = ghost !== null && github !== null && ghost !== github;
  const action = decideRef({
    base: row?.baseSha ?? setupBase,
    ghost,
    github,
    ghostHasGithub: both && (await ctx.git.isAncestor(ctx.dir, github, ghost)),
    githubHasGhost: both && (await ctx.git.isAncestor(ctx.dir, ghost, github)),
  });

  if (action.kind === "none") return "done";
  if (action.kind === "record") {
    await ctx.store.setBase(ctx.sync.id, name, action.sha);
    await forgetSetup(ctx, name);
    return "done";
  }
  if (action.kind === "diverged") {
    await flag(ctx, name, row?.diverged ?? null, { ghost, github, reason: "diverged" });
    return "done";
  }

  const pushed = await ctx.git.pushRef(ctx.dir, remotes[action.to], name, action.sha, action.expected);
  if (pushed.ok) {
    await ctx.store.setBase(ctx.sync.id, name, action.sha);
    const verb = action.sha === null ? "Deleted" : action.expected === null ? "Created" : "Moved";
    const summary = `${verb} ${name.replace(/^refs\/(heads|tags)\//, "")}${action.sha === null ? "" : ` at ${short(action.sha)}`}`;
    await ctx.store.addActivity({ syncId: ctx.sync.id, direction: action.to, kind: "refs", summary, error: null });
    await forgetSetup(ctx, name);
    // Statuses reported before the commit arrived were skipped then; the commit is here now.
    if (action.sha !== null) await syncStatuses(ctx, other(action.to), action.sha);
    return "done";
  }
  if (pushed.reason === "lease") return "lease";
  // The setup base stays until a push lands, so a retry after the host lifts its rule still knows which side moved.
  await flag(ctx, name, row?.diverged ?? null, { ghost, github, reason: `rejected: ${pushed.message}` });
  return "done";
}

/** Once a ref has synced, where it stood at setup says nothing more: a deletion synced since removes its base, and the setup commit must not come back as one. */
async function forgetSetup(ctx: SyncContext, name: string) {
  const setup = ctx.sync.refsAtSetup;
  if (!setup || (!(name in setup.ghost) && !(name in setup.github))) return;
  const { [name]: _ghost, ...ghost } = setup.ghost;
  const { [name]: _github, ...github } = setup.github;
  ctx.sync.refsAtSetup = { ghost, github };
  await ctx.store.updateSync(ctx.sync.id, { refsAtSetup: ctx.sync.refsAtSetup });
}

/** Records the flag and tells people once per distinct state; a notice that failed is retried until it lands. */
async function flag(ctx: SyncContext, name: string, current: RefFlag | null, next: RefFlag) {
  const same = current !== null && current.ghost === next.ghost && current.github === next.github && current.reason === next.reason;
  if (same && current.notified !== false) return;
  let state: RefFlag = same ? current : { ...next, notified: false, posted: [] };
  if (!same) {
    await ctx.store.flagRef(ctx.sync.id, name, state);
    const summary = `${name} not synced (${next.reason}): Ghost at ${short(next.ghost)}, GitHub at ${short(next.github)}`;
    await ctx.store.addActivity({ syncId: ctx.sync.id, direction: null, kind: "refs", summary, error: next.reason });
  }
  // Each comment is recorded as it lands, so a retry after a partial failure posts only the ones still missing.
  const posted = async (target: string) => {
    state = { ...state, posted: [...(state.posted ?? []), target] };
    await ctx.store.flagRef(ctx.sync.id, name, state);
  };
  try {
    if (name.startsWith("refs/heads/")) await notifyPulls(ctx, name.slice("refs/heads/".length), state, posted);
    await ctx.store.flagRef(ctx.sync.id, name, { ...state, notified: true });
  } catch (error) {
    // The flag is saved either way; a failed notice must not stop the remaining refs from syncing.
    const message = error instanceof Error ? error.message : String(error);
    await ctx.store.addActivity({ syncId: ctx.sync.id, direction: null, kind: "comment", summary: `Could not comment on pull requests from ${name}`, error: message });
  }
}

/** Comments on both halves of every linked pull request headed by `branch`, skipping targets in `state.posted`. */
async function notifyPulls(ctx: SyncContext, branch: string, state: RefFlag, posted: (target: string) => Promise<void>) {
  const body = `Ghost Sync stopped syncing \`${branch}\`: Ghost is at ${short(state.ghost)} and GitHub at ${short(state.github)} (${state.reason}). Make the two sides agree, for example by merging one into the other, and syncing resumes.`;
  const { owner } = ctx.repo.ghost;
  // Linked pull requests exist on both sides, so Ghost's list finds every pair.
  const pulls = await ctx.rest.ghost.request<{ number: number }[]>("GET", `/repos/${owner}/${ctx.repo.ghost.name}/pulls?state=open&head=${owner}:${branch}`);
  for (const pull of pulls) {
    const link = await ctx.store.findLink(ctx.sync.id, "pull", "ghost", String(pull.number));
    if (!link) continue;
    for (const [side, number] of [["ghost", link.ghostId], ["github", link.githubId]] as const) {
      const target = `${side}#${number}`;
      if (state.posted?.includes(target)) continue;
      const repo = ctx.repo[side];
      await ctx.rest[side].request("POST", `/repos/${repo.owner}/${repo.name}/issues/${number}/comments`, { body });
      await posted(target);
    }
  }
}
