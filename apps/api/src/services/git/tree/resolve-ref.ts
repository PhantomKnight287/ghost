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
