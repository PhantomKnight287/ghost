import { schema } from '@ghost/db';
import { sql } from 'drizzle-orm';

import { listCommits } from '../git/commits/list-commits.js';
import { alternatesEnv } from '../git/diff/diff.js';
import type { Executor } from '../issues/close-issue.js';

// What one push adds to a timeline, as GitHub caps it. A longer push shows its newest commits.
export const MAX_TIMELINE_COMMITS = 250;

/** Commits `tip` brings that none of `exclude` reaches, oldest first: what a push added to a pull request, leaving out the base commits a merge or rebase pulled in. */
export async function commitsAdded({
  gitDir,
  alternates,
  tip,
  exclude,
}: {
  gitDir: string;
  alternates: string[];
  tip: string;
  exclude: string[];
}) {
  const { commits } = await listCommits({
    gitDir,
    env: alternatesEnv(alternates),
    ref: [tip, ...exclude.map((sha) => `^${sha}`)],
    limit: MAX_TIMELINE_COMMITS,
  });
  return commits.reverse();
}

/** Writes a pull request's `committed` events, after a `head_force_pushed` one when the push rewrote the branch. Each row is a millisecond after the last, so the timeline keeps the commits in order and after anything else written in the same transaction. */
export async function recordCommitEvents(
  db: Executor,
  {
    issueId,
    actorId,
    commits,
    forced,
  }: {
    issueId: string;
    actorId: string | null;
    commits: { sha: string; subject: string; authorName: string }[];
    forced?: { before: string; after: string };
  },
) {
  const rows = [
    ...(forced
      ? [
          {
            type: 'head_force_pushed' as const,
            beforeSha: forced.before,
            commitSha: forced.after,
          },
        ]
      : []),
    ...commits.map((commit) => ({
      type: 'committed' as const,
      commitSha: commit.sha,
      commitMessage: commit.subject,
      commitAuthorName: commit.authorName,
    })),
  ];
  if (rows.length === 0) return;

  await db.insert(schema.issueEvent).values(
    rows.map((row, index) => ({
      ...row,
      issueId,
      actorId,
      createdAt: sql`now() + ${index + 1} * interval '1 millisecond'`,
    })),
  );
}
