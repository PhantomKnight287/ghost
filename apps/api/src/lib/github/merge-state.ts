import type { CommitStatusState } from '../commit-statuses/commit-statuses.js';

/** GitHub's merge state for a pull request that is open, not a draft and merges cleanly: BEHIND when only an out-of-date head holds it back, BLOCKED for anything else the rules leave unmet (bypass actors included, as on GitHub), UNSTABLE when nothing is unmet but a status on the head fails. */
export function mergeStateOf(
  unmet: { requirement?: string }[],
  headState: CommitStatusState | null,
): 'behind' | 'blocked' | 'unstable' | 'clean' {
  if (unmet.length > 0)
    return unmet.every(({ requirement }) => requirement === 'up_to_date')
      ? 'behind'
      : 'blocked';
  return headState === 'failure' ? 'unstable' : 'clean';
}
