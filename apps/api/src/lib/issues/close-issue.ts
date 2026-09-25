import { type Database, schema } from '@ghost/db';
import { and, eq } from 'drizzle-orm';

// Commits a push or merge scans for closing keywords. A longer range closes only through the newest ones.
export const MAX_CLOSING_COMMITS = 250;

export type Executor = Pick<
  Database,
  'select' | 'insert' | 'update' | 'delete'
>;

/** Closes an issue that is still open and records why: `closed`, naming the pull request or commit that closed it when there is one, or `merged` for a pull request's own issue. Returns null when the issue was not open, so two racing closes record one event. */
export async function closeIssue(
  db: Executor,
  {
    issueId,
    actorId,
    type = 'closed',
    sourceIssueId,
    commitSha,
  }: {
    issueId: string;
    actorId: string | null;
    type?: 'closed' | 'merged';
    sourceIssueId?: string;
    commitSha?: string;
  },
) {
  const [closed] = await db
    .update(schema.issue)
    .set({ state: 'closed', closedAt: new Date(), closedById: actorId })
    .where(and(eq(schema.issue.id, issueId), eq(schema.issue.state, 'open')))
    .returning();
  if (!closed) return null;

  await db.insert(schema.issueEvent).values({
    issueId,
    actorId,
    type,
    sourceIssueId,
    commitSha,
  });
  return closed;
}
