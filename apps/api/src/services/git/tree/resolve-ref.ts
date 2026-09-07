import { runGit } from '../exec/run-git.js';

const FALLBACK_REF = 'refs/heads/main';

/** Accepts "main" or "refs/heads/main" and always returns the full ref. */
export function toBranchRef(branch: string) {
  return branch.startsWith('refs/') ? branch : `refs/heads/${branch}`;
}

/**
 * The ref a repository page should show. `defaultBranch` is authoritative when
 * a push has recorded one; otherwise fall back to the HEAD the materializer
 * picked, which already prefers main/master over whatever was pushed first.
 */
export async function resolveDefaultRef({
  gitDir,
  defaultBranch,
}: {
  gitDir: string;
  defaultBranch?: string | null;
}) {
  if (defaultBranch) return toBranchRef(defaultBranch);

  const head = await runGit({
    args: ['symbolic-ref', '--quiet', 'HEAD'],
    gitDir,
  }).catch(() => '');

  return head.trim() || FALLBACK_REF;
}

/**
 * What the caller asked to look at, resolved to something git accepts as a
 * revision. A branch name wins over a sha, since a branch could in principle be
 * named like one; `detached` marks a commit, which has no moving tip.
 *
 * Returns null when the revision names nothing in the repository.
 */
export async function resolveRevision({
  gitDir,
  branches,
  requested,
}: {
  gitDir: string;
  branches: string[];
  requested: string;
}): Promise<{ ref: string; detached: boolean } | null> {
  // re-prefixed rather than trusted, so a name can never reach git as a flag
  // or another ref namespace
  const name = requested.replace(/^refs\/heads\//, '');
  if (branches.includes(name)) {
    return { ref: `refs/heads/${name}`, detached: false };
  }

  // a sha, full or abbreviated, resolved to the commit it names
  if (!/^[0-9a-f]{4,40}$/.test(name)) return null;

  const sha = await runGit({
    args: [
      'rev-parse',
      '--quiet',
      '--verify',
      '--end-of-options',
      `${name}^{commit}`,
    ],
    gitDir,
  }).catch(() => '');

  return sha.trim() ? { ref: sha.trim(), detached: true } : null;
}
