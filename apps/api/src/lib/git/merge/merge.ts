import { stat } from 'node:fs/promises';

import { alternatesEnv } from '../diff/diff.js';
import { GitCommandFailedError } from '../exec/exec.errors.js';
import { runGit } from '../exec/run-git.js';

export interface MergeContext {
  gitDir: string;
  alternates?: string[];
}

/** Merges two commits into a tree without a worktree or an index, so a bare cache can answer "does this conflict, and where" and build the result from one call. The tree of a conflicted merge holds conflict markers and must not be committed. */
export async function mergeTree({
  gitDir,
  alternates,
  base,
  head,
  mergeBase,
}: MergeContext & {
  base: string;
  head: string;
  /** Overrides the computed merge base, which turns the merge into a cherry-pick of `head` when given its parent. */
  mergeBase?: string;
}): Promise<{ tree: string; clean: boolean; conflicts: string[] }> {
  const args = [
    'merge-tree',
    '--write-tree',
    '--name-only',
    '-z',
    ...(mergeBase ? [`--merge-base=${mergeBase}`] : []),
    '--end-of-options',
    base,
    head,
  ];
  try {
    return {
      ...parseMergeTree(
        await runGit({ args, gitDir, env: alternatesEnv(alternates) }),
      ),
      clean: true,
    };
  } catch (error) {
    // A conflict and an unreadable commit both exit 1. Only the conflict keeps stderr empty, writing its tree and the conflicted paths to stdout, so a fork whose objects were never lent must not read as "merges cleanly".
    if (
      error instanceof GitCommandFailedError &&
      error.exitCode === 1 &&
      error.stderr === ''
    ) {
      // The exit status decides cleanliness; the path list only names what it can.
      return { ...parseMergeTree(error.stdout), clean: false };
    }
    throw error;
  }
}

/** `-z` output: the tree, then one conflicted path per entry, then an empty entry before the messages. */
function parseMergeTree(raw: string) {
  const [tree, ...rest] = raw.split('\0');
  const end = rest.indexOf('');
  return { tree, conflicts: end === -1 ? [] : rest.slice(0, end) };
}

export async function commitTree({
  gitDir,
  alternates,
  tree,
  parents,
  message,
  author,
  committer = author,
}: MergeContext & {
  tree: string;
  parents: string[];
  message: string;
  /** `date` is git's raw `<seconds> <offset>`, kept when a commit is replayed; without it git stamps the current time. */
  author: { name: string; email: string; date?: string };
  committer?: { name: string; email: string; date?: string };
}): Promise<string> {
  const raw = await runGit({
    args: [
      'commit-tree',
      tree,
      ...parents.flatMap((parent) => ['-p', parent]),
      '-m',
      message,
    ],
    gitDir,
    env: {
      ...alternatesEnv(alternates),
      // a bare cache has no configured identity, and git refuses to guess one
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      ...(author.date && { GIT_AUTHOR_DATE: author.date }),
      GIT_COMMITTER_NAME: committer.name,
      GIT_COMMITTER_EMAIL: committer.email,
      ...(committer.date && { GIT_COMMITTER_DATE: committer.date }),
    },
  });

  return raw.trim();
}

const TEST_MERGE_IDENTITY = { name: 'Ghost', email: 'noreply@ghost.local' };

/** What `base` would become if `head` merged into it now, or null when they conflict. Dated by its later parent rather than the clock, so recomputing an unchanged pair rebuilds the same commit and leaves nothing to write. */
export async function testMergeCommit({
  gitDir,
  alternates,
  base,
  head,
}: MergeContext & { base: string; head: string }): Promise<string | null> {
  const { tree, clean } = await mergeTree({ gitDir, alternates, base, head });
  if (!clean) return null;

  const dates = await runGit({
    args: ['log', '--no-walk', '--format=%ct', '--end-of-options', base, head],
    gitDir,
    env: alternatesEnv(alternates),
  });
  const identity = {
    ...TEST_MERGE_IDENTITY,
    date: `${Math.max(...dates.trim().split('\n').map(Number))} +0000`,
  };
  return commitTree({
    gitDir,
    alternates,
    tree,
    parents: [base, head],
    message: `Merge ${head} into ${base}\n`,
    author: identity,
    committer: identity,
  });
}

/**
 * Replays every non-merge commit in `from..to` onto `onto`, oldest first, keeping each one's author and message; merge commits are dropped, the way `git rebase` linearizes a branch.
 *
 * Stops at the first commit that conflicts and names its paths. Nothing is written but objects, so a conflict leaves no trace a caller has to undo.
 */
export async function rebaseCommits({
  gitDir,
  alternates,
  onto,
  from,
  to,
  committer,
}: MergeContext & {
  onto: string;
  from: string;
  to: string;
  committer: { name: string; email: string };
}): Promise<
  { clean: true; tip: string } | { clean: false; conflicts: string[] }
> {
  const raw = await runGit({
    args: [
      'log',
      '--reverse',
      '--no-merges',
      '-z',
      '--date=raw',
      '--format=%H%x00%an%x00%ae%x00%ad%x00%B',
      '--end-of-options',
      to,
      `^${from}`,
      `^${onto}`,
    ],
    gitDir,
    env: alternatesEnv(alternates),
  });

  // -z ends each record with a NUL too, so every commit is exactly five fields.
  const fields = raw.split('\0');
  let tip = onto;
  for (let i = 0; i + 5 <= fields.length; i += 5) {
    const [sha, name, email, date, message] = fields.slice(i, i + 5);
    const merged = await mergeTree({
      gitDir,
      alternates,
      base: tip,
      head: sha,
      mergeBase: `${sha}^`,
    });
    if (!merged.clean) return { clean: false, conflicts: merged.conflicts };

    tip = await commitTree({
      gitDir,
      alternates,
      tree: merged.tree,
      parents: [tip],
      message,
      author: { name, email, date },
      committer,
    });
  }
  return { clean: true, tip };
}

/**
 * A packfile holding everything reachable from `include` that `exclude` does not already cover.
 *
 * `exclude` must be what the *target* log already holds, never the head commit: a fork's commits live in another repository's log, so excluding them would write an entry whose merge commit no node could ever replay.
 */
export async function packRange({
  gitDir,
  alternates,
  include,
  exclude,
  prefix,
}: MergeContext & {
  include: string[];
  exclude: string[];
  prefix: string;
}): Promise<{ path: string; size: number }> {
  const name = await runGit({
    args: ['pack-objects', '--revs', '--quiet', prefix],
    gitDir,
    env: alternatesEnv(alternates),
    input: Buffer.from(
      [...include, ...exclude.map((sha) => `^${sha}`)].join('\n') + '\n',
      'utf8',
    ),
  });

  const path = `${prefix}-${name.trim()}.pack`;
  return { path, size: (await stat(path)).size };
}
