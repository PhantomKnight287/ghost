import { runGit } from '../exec/run-git.js';

const RECORD = '\x1e';
const FIELD = '\x1f';
const FORMAT = `--format=${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%ct${FIELD}%s${FIELD}%b`;

export interface Commit {
  sha: string;
  authorName: string;
  authorEmail: string;
  committedAt: Date;
  subject: string;
  body: string;
}

export interface CommitFile {
  /** A for added, M for modified, D for deleted. */
  status: string;
  path: string;
}

/** A commit-ish a caller supplied, safe to hand git as a revision. */
export function isSha(value: string) {
  return /^[0-9a-f]{4,40}$/.test(value);
}

function parse(record: string): Commit | null {
  const [sha, authorName, authorEmail, committedAt, subject, body] =
    record.split(FIELD);
  if (!sha) return null;

  return {
    sha,
    authorName,
    authorEmail,
    committedAt: new Date(Number(committedAt) * 1000),
    subject,
    body: (body ?? '').trim(),
  };
}

/**
 * Newest-first history of a ref, one page at a time. `cursor` is the sha to
 * resume from, which stays correct as new commits land on top.
 */
export async function listCommits({
  gitDir,
  ref,
  path,
  limit,
  cursor,
}: {
  gitDir: string;
  ref: string;
  path?: string;
  limit: number;
  cursor?: string;
}): Promise<{ commits: Commit[]; nextCursor: string | null }> {
  const args = [
    'log',
    FORMAT,
    // one extra row answers "is there another page" without a second walk
    '-n',
    String(limit + 1),
    '--end-of-options',
    cursor ?? ref,
  ];
  if (path) args.push('--', path);

  const raw = await runGit({ args, gitDir });
  const commits = raw.split(RECORD).flatMap((record) => parse(record) ?? []);

  return {
    commits: commits.slice(0, limit),
    nextCursor: commits.length > limit ? commits[limit].sha : null,
  };
}

/** One commit with the paths it changed, or null when the sha is unknown. */
export async function readCommit({
  gitDir,
  sha,
}: {
  gitDir: string;
  sha: string;
}): Promise<(Commit & { files: CommitFile[] }) | null> {
  const raw = await runGit({
    args: ['show', '-s', FORMAT, '--end-of-options', sha],
    gitDir,
  }).catch(() => '');

  const commit = parse(raw.split(RECORD)[1] ?? '');
  if (!commit) return null;

  const changes = await runGit({
    args: [
      'show',
      '--name-status',
      '--format=',
      '-z',
      '--no-renames',
      // a merge shows nothing without this, and its first-parent diff is what
      // a reader expects to see
      '--first-parent',
      '--end-of-options',
      commit.sha,
    ],
    gitDir,
  });

  const parts = changes.split('\0').filter(Boolean);
  const files: CommitFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    files.push({ status: parts[i], path: parts[i + 1] });
  }

  return { ...commit, files };
}
