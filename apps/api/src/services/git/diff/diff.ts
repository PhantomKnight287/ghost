import path from 'node:path';
import type { Readable } from 'node:stream';

import { runGit, runGitReadable } from '../exec/run-git.js';

export interface DiffFile {
  /** `A` added, `M` modified, `D` deleted. */
  status: string;
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface DiffRange {
  gitDir: string;
  /**
   * Object stores to read alongside `gitDir`'s own. A fork request spans two
   * caches, and lending the objects beats copying them between the two.
   */
  alternates?: string[];
  from: string;
  to: string;
}

export function alternatesEnv(alternates: string[] = []) {
  if (alternates.length === 0) return undefined;
  return {
    GIT_ALTERNATE_OBJECT_DIRECTORIES: alternates
      .map((directory) => path.join(directory, 'objects'))
      .join(path.delimiter),
  };
}

/** The commit both refs descend from, or null when their histories are unrelated. */
export async function mergeBase({
  gitDir,
  alternates,
  a,
  b,
}: {
  gitDir: string;
  alternates?: string[];
  a: string;
  b: string;
}): Promise<string | null> {
  const raw = await runGit({
    args: ['merge-base', '--end-of-options', a, b],
    gitDir,
    env: alternatesEnv(alternates),
  }).catch(() => '');

  return raw.trim() || null;
}

/**
 * Paths changed between two commits, with line counts.
 *
 * `--no-renames` keeps both records two fields wide, so a rename reads as a
 * delete and an add rather than needing a third parse shape.
 */
export async function listDiffFiles({
  gitDir,
  alternates,
  from,
  to,
}: DiffRange): Promise<DiffFile[]> {
  const env = alternatesEnv(alternates);
  const range = ['--no-renames', '-z', '--end-of-options', from, to];

  const [numstat, nameStatus] = await Promise.all([
    runGit({ args: ['diff', '--numstat', ...range], gitDir, env }),
    runGit({ args: ['diff', '--name-status', ...range], gitDir, env }),
  ]);

  // git writes "-\t-" for the counts of a binary file
  const counts = new Map<string, Omit<DiffFile, 'status' | 'path'>>();
  for (const record of numstat.split('\0').filter(Boolean)) {
    const [additions, deletions, changed] = record.split('\t');
    if (changed === undefined) continue;
    counts.set(changed, {
      additions: Number(additions) || 0,
      deletions: Number(deletions) || 0,
      binary: additions === '-' && deletions === '-',
    });
  }

  const parts = nameStatus.split('\0').filter(Boolean);
  const files: DiffFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const changed = parts[i + 1];
    files.push({
      status: parts[i],
      path: changed,
      additions: 0,
      deletions: 0,
      binary: false,
      ...counts.get(changed),
    });
  }

  return files;
}

/** The patch text itself, streamed - a large review diff should not be buffered. */
export function streamDiffPatch({
  gitDir,
  alternates,
  from,
  to,
  path: only,
}: DiffRange & { path?: string }): Readable {
  return runGitReadable({
    args: [
      'diff',
      '--no-renames',
      '--end-of-options',
      from,
      to,
      ...(only ? ['--', `:(literal)${only}`] : []),
    ],
    gitDir,
    env: alternatesEnv(alternates),
  });
}
