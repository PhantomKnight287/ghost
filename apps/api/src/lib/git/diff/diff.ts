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
  /** Object stores to read alongside `gitDir`'s own. A fork request spans two caches, and lending the objects beats copying them between the two. */
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

/** Whether `descendant` contains `ancestor`. False as well when either object is gone, since a caller cannot build on a commit it cannot read. */
export function isAncestor(
  gitDir: string,
  ancestor: string,
  descendant: string,
) {
  return runGit({
    args: ['merge-base', '--is-ancestor', ancestor, descendant],
    gitDir,
  }).then(
    () => true,
    () => false,
  );
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
 * `--no-renames` keeps both records two fields wide, so a rename reads as a delete and an add rather than needing a third parse shape.
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

/** `git diff` of `from..to` as a patch, limited to one literal path when given. */
function patchArgs(from: string, to: string, path?: string) {
  return [
    'diff',
    '--no-renames',
    '--end-of-options',
    from,
    to,
    ...(path ? ['--', `:(literal)${path}`] : []),
  ];
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
    args: patchArgs(from, to, only),
    gitDir,
    env: alternatesEnv(alternates),
  });
}

export interface DiffLine {
  kind: ' ' | '+' | '-';
  /** Line number on the base side; for an added line, the base line it comes before. */
  old: number;
  /** Line number on the head side; for a deleted line, the head line it comes before. */
  new: number;
  text: string;
}

export interface Hunk {
  /** First and last line each side shows, context included. */
  deletions: [number, number];
  additions: [number, number];
  lines: DiffLine[];
}

/** One file's diff as hunks of numbered lines. Empty for a binary file or a path the diff does not touch. */
export async function fileHunks({
  gitDir,
  alternates,
  from,
  to,
  path: only,
}: DiffRange & { path: string }): Promise<Hunk[]> {
  const patch = await runGit({
    args: patchArgs(from, to, only),
    gitDir,
    env: alternatesEnv(alternates),
  });
  return parseHunks(patch);
}

/** Hunk bodies are read by their header's counts rather than by prefix, since a removed line reading `-- x` looks like a file header. */
export function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  const rows = patch.split('\n');
  for (let index = 0; index < rows.length; index++) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(
      rows[index],
    );
    if (!header) continue;

    let [old, remainingOld, next, remainingNew] = [
      Number(header[1]),
      Number(header[2] ?? 1),
      Number(header[3]),
      Number(header[4] ?? 1),
    ];
    const hunk: Hunk = {
      deletions: [old, old + remainingOld - 1],
      additions: [next, next + remainingNew - 1],
      lines: [],
    };
    while ((remainingOld > 0 || remainingNew > 0) && index + 1 < rows.length) {
      const row = rows[++index];
      const kind = row[0];
      if (kind !== ' ' && kind !== '+' && kind !== '-') continue;
      hunk.lines.push({ kind, old, new: next, text: row.slice(1) });
      if (kind !== '+') [old, remainingOld] = [old + 1, remainingOld - 1];
      if (kind !== '-') [next, remainingNew] = [next + 1, remainingNew - 1];
    }
    hunks.push(hunk);
  }
  return hunks;
}
