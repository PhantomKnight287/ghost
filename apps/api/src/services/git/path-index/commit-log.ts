import { runGitStream } from '../exec/run-git.js';

/**
 * Record and field separators for the `git log` format below. `-z` already
 * NUL-terminates the changed paths and NUL-separates the commits themselves,
 * which is ambiguous, so a leading \x01 marks where each commit starts.
 */
const RECORD = '\x01';
const FIELD = '\x1f';

export const COMMIT_FORMAT = `--format=${RECORD}%H${FIELD}%ct${FIELD}%s`;

export interface CommitRecord {
  sha: string;
  committedAt: Date;
  subject: string;
  /** Repository-relative paths this commit changed. Empty for merges. */
  paths: string[];
}

export interface WalkCommitsOptions {
  gitDir: string;
  /** Anything `git log` accepts: a tip, or `<since>..<tip>` for a top-up. */
  range: string;
  /** Limits the walk - and the reported paths - to one subtree. */
  pathspec?: string;
}

/**
 * Walks history oldest-first, yielding each commit with the paths it touched.
 *
 * Merges are left opaque (no `--diff-merges`), so a file that arrived on a side
 * branch is attributed to the commit that actually wrote it rather than to the
 * merge that carried it - which is what a file listing wants to show. Combined
 * with `--reverse --topo-order`, a caller that keeps the last write per path
 * ends up with the newest commit touching it.
 */
export async function* walkCommits({
  gitDir,
  range,
  pathspec,
}: WalkCommitsOptions): AsyncGenerator<CommitRecord> {
  const args = [
    'log',
    '--reverse',
    '--topo-order',
    '--no-renames',
    COMMIT_FORMAT,
    '-z',
    '--name-only',
    // ranges are built from refs, and one starting with "-" would parse as an
    // option rather than as a revision
    '--end-of-options',
    range,
  ];
  if (pathspec) args.push('--', pathspec);

  yield* readCommitRecords(runGitStream({ args, gitDir }));
}

/** Splits the raw stream into records; exported for the parser's own tests. */
export async function* readCommitRecords(
  chunks: AsyncIterable<string>,
): AsyncGenerator<CommitRecord> {
  let carry = '';

  for await (const chunk of chunks) {
    carry += chunk;
    const records = carry.split(RECORD);
    // the trailing piece may be a partial record, so hold it for the next chunk
    carry = records.pop() ?? '';
    for (const record of records) {
      const parsed = parseRecord(record);
      if (parsed) yield parsed;
    }
  }

  const parsed = parseRecord(carry);
  if (parsed) yield parsed;
}

/** `<sha>\x1f<epoch>\x1f<subject>\0\n<path>\0<path>\0` */
function parseRecord(record: string): CommitRecord | null {
  // A subject can hold anything but NUL, so the first NUL is the only
  // boundary that is safe to split the header on.
  const boundary = record.indexOf('\0');
  if (boundary === -1) return null;

  const [sha, epoch, ...subject] = record.slice(0, boundary).split(FIELD);
  if (!sha || !epoch) return null;

  const seconds = Number.parseInt(epoch, 10);
  if (!Number.isFinite(seconds)) return null;

  return {
    sha,
    committedAt: new Date(seconds * 1000),
    subject: subject.join(FIELD),
    paths: record
      .slice(boundary + 1)
      .replace(/^\n/, '')
      .split('\0')
      .filter(Boolean),
  };
}
