import type { Remote } from "../git.ts";
import type { Side } from "../side.ts";
import type { RefFlag } from "../store.ts";
import type { SyncContext } from "./context.ts";

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

/** Brings every branch and tag (or only `only`) into agreement. `ghost-pr/*` heads belong to pull requests. */
export async function syncRefs(ctx: SyncContext, only?: string[]) {
  const remotes = await ctx.remote();
  let fetched = await ctx.git.fetchBoth(ctx.dir, remotes);
  const stored = await ctx.store.listRefs(ctx.sync.id);
  const names = new Set([...fetched.ghost.keys(), ...fetched.github.keys(), ...stored.map((r) => r.name)]);

  for (const name of names) {
    if (only && !only.includes(name)) continue;
    if (name.startsWith("refs/heads/ghost-pr/")) continue;
    for (let attempt = 1; ; attempt++) {
      const outcome = await syncRef(ctx, remotes, name, fetched.ghost.get(name) ?? null, fetched.github.get(name) ?? null);
      // A lease failure means a person pushed between our fetch and our push: compare again once against what they pushed.
      if (outcome !== "lease" || attempt === 2) break;
      fetched = await ctx.git.fetchBoth(ctx.dir, remotes);
    }
  }
}

async function syncRef(ctx: SyncContext, remotes: Record<Side, Remote>, name: string, ghost: string | null, github: string | null) {
  const row = await ctx.store.getRef(ctx.sync.id, name);
  const both = ghost !== null && github !== null && ghost !== github;
  const action = decideRef({
    base: row?.baseSha ?? null,
    ghost,
    github,
    ghostHasGithub: both && (await ctx.git.isAncestor(ctx.dir, github, ghost)),
    githubHasGhost: both && (await ctx.git.isAncestor(ctx.dir, ghost, github)),
  });

  if (action.kind === "none") return "done";
  if (action.kind === "record") {
    await ctx.store.setBase(ctx.sync.id, name, action.sha);
    return "done";
  }
  if (action.kind === "diverged") {
    await flag(ctx, name, row?.diverged ?? null, { ghost, github, reason: "diverged" });
    return "done";
  }

  const pushed = await ctx.git.pushRef(ctx.dir, remotes[action.to], name, action.sha, action.expected);
  if (pushed.ok) {
    await ctx.store.setBase(ctx.sync.id, name, action.sha);
    return "done";
  }
  if (pushed.reason === "lease") return "lease";
  await flag(ctx, name, row?.diverged ?? null, { ghost, github, reason: `rejected: ${pushed.message}` });
  return "done";
}

/** Records the flag and tells people once per distinct state; a notice that failed is retried until it lands. */
async function flag(ctx: SyncContext, name: string, current: RefFlag | null, next: RefFlag) {
  const same = current !== null && current.ghost === next.ghost && current.github === next.github && current.reason === next.reason;
  if (same && current.notified !== false) return;
  if (!same) {
    await ctx.store.flagRef(ctx.sync.id, name, { ...next, notified: false });
    const summary = `${name} not synced (${next.reason}): Ghost at ${short(next.ghost)}, GitHub at ${short(next.github)}`;
    await ctx.store.addActivity({ syncId: ctx.sync.id, direction: null, kind: "refs", summary, error: next.reason });
  }
  try {
    if (name.startsWith("refs/heads/")) await notifyPulls(ctx, name.slice("refs/heads/".length), next);
    await ctx.store.flagRef(ctx.sync.id, name, { ...next, notified: true });
  } catch (error) {
    // The flag is saved either way; a failed notice must not stop the remaining refs from syncing.
    const message = error instanceof Error ? error.message : String(error);
    await ctx.store.addActivity({ syncId: ctx.sync.id, direction: null, kind: "comment", summary: `Could not comment on pull requests from ${name}`, error: message });
  }
}

/** Comments on both halves of every linked pull request headed by `branch`. */
async function notifyPulls(ctx: SyncContext, branch: string, next: RefFlag) {
  const ghost = ctx.repo.ghost;
  const github = ctx.repo.github;
  const body = `sync.ghost stopped syncing \`${branch}\`: Ghost is at ${short(next.ghost)} and GitHub at ${short(next.github)} (${next.reason}). Make the two sides agree, for example by merging one into the other, and syncing resumes.`;
  // Linked pull requests exist on both sides, so Ghost's list finds every pair.
  const pulls = await ctx.rest.ghost.request<{ number: number }[]>("GET", `/repos/${ghost.owner}/${ghost.name}/pulls?state=open&head=${ghost.owner}:${branch}`);
  for (const pull of pulls) {
    const link = await ctx.store.findLink(ctx.sync.id, "pull", "ghost", String(pull.number));
    if (!link) continue;
    // ponytail: a failure after some comments landed re-posts them on the retry; per-pull notice state if that shows up in practice.
    await ctx.rest.ghost.request("POST", `/repos/${ghost.owner}/${ghost.name}/issues/${pull.number}/comments`, { body });
    await ctx.rest.github.request("POST", `/repos/${github.owner}/${github.name}/issues/${link.githubId}/comments`, { body });
  }
}
