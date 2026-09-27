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
}: MergeContext & {
  base: string;
  head: string;
}): Promise<{ tree: string; conflicts: string[] }> {
  const args = [
    'merge-tree',
    '--write-tree',
    '--name-only',
    '-z',
    '--end-of-options',
    base,
    head,
  ];
  try {
    return parseMergeTree(
      await runGit({ args, gitDir, env: alternatesEnv(alternates) }),
    );
  } catch (error) {
    // A conflict and an unreadable commit both exit 1. Only the conflict keeps stderr empty, writing its tree and the conflicted paths to stdout, so a fork whose objects were never lent must not read as "merges cleanly".
    if (
      error instanceof GitCommandFailedError &&
      error.exitCode === 1 &&
      error.stderr === ''
    ) {
      return parseMergeTree(error.stdout);
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
}: MergeContext & {
  tree: string;
  parents: string[];
  message: string;
  author: { name: string; email: string };
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
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    },
  });

  return raw.trim();
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
  include: string;
  exclude: string[];
  prefix: string;
}): Promise<{ path: string; size: number }> {
  const name = await runGit({
    args: ['pack-objects', '--revs', '--quiet', prefix],
    gitDir,
    env: alternatesEnv(alternates),
    input: Buffer.from(
      [include, ...exclude.map((sha) => `^${sha}`)].join('\n') + '\n',
      'utf8',
    ),
  });

  const path = `${prefix}-${name.trim()}.pack`;
  return { path, size: (await stat(path)).size };
}
