import { runGit } from '../exec/run-git.js';

const FALLBACK_REF = 'refs/heads/main';

/** Accepts "main" or "refs/heads/main" and always returns the full ref. */
export const BRANCH_PREFIX = 'refs/heads/';

export function toBranchRef(branch: string) {
  return branch.startsWith('refs/') ? branch : `${BRANCH_PREFIX}${branch}`;
}

/** The ref a repository page shows: the recorded `defaultBranch`, else the HEAD the materializer picked. */
export async function resolveDefaultRef({
  gitDir,
  defaultBranch,
}: {
  gitDir: string;
  defaultBranch?: string | null;
}) {
  if (defaultBranch) return toBranchRef(defaultBranch);

  return (await headRef(gitDir)) ?? FALLBACK_REF;
}

/** A branch wins over a tag and a tag over a sha, since either could in principle be named like the next; `detached` marks a commit, which has no moving tip. */
export async function resolveRevision({
  gitDir,
  branches,
  tags,
  requested,
}: {
  gitDir: string;
  branches: string[];
  tags: { name: string; sha: string }[];
  requested: string;
}): Promise<{ ref: string; detached: boolean } | null> {
  // re-prefixed rather than trusted, so a name can never reach git as a flag or another ref namespace
  const name = requested.replace(/^refs\/heads\//, '');
  if (branches.includes(name)) {
    return { ref: `refs/heads/${name}`, detached: false };
  }

  // a tag never moves, so it reads as the commit it names
  const tag = tags.find((candidate) => candidate.name === requested);
  if (tag) return { ref: tag.sha, detached: true };

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

export async function resolveCommit(gitDir: string, ref: string) {
  const oid = await runGit({
    args: [
      'rev-parse',
      '--verify',
      '--quiet',
      '--end-of-options',
      `${ref}^{commit}`,
    ],
    gitDir,
  }).catch(() => '');
  return oid.trim() || null;
}

/** The commit `requested` names, as `resolveRevision` reads it, or the default branch's tip when nothing is requested. Null when it names nothing. */
export async function resolveTargetCommit({
  gitDir,
  defaultBranch,
  branches,
  tags,
  requested,
}: {
  gitDir: string;
  defaultBranch: string | null;
  branches: string[];
  tags: { name: string; sha: string }[];
  requested: string | undefined;
}) {
  const ref = requested
    ? (await resolveRevision({ gitDir, branches, tags, requested }))?.ref
    : await resolveDefaultRef({ gitDir, defaultBranch });
  return ref ? resolveCommit(gitDir, ref) : null;
}

/** The branch HEAD points at, or null when HEAD is detached or unset. */
export async function headRef(gitDir: string) {
  const head = await runGit({
    args: ['symbolic-ref', '--quiet', 'HEAD'],
    gitDir,
  }).catch(() => '');
  return head.trim() || null;
}
