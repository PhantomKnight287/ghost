import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

/** The repository and number behind an issue's Ghost id, or null. */
export async function issueRefOf(db: Database, issueId: string) {
  const [row] = await db.select({ repositoryId: schema.issue.repositoryId, number: schema.issue.number }).from(schema.issue).where(eq(schema.issue.id, issueId));
  return row ?? null;
}

/** The issue a comment belongs to, or null. */
export async function commentIssueOf(db: Database, commentId: string) {
  const [row] = await db.select({ issueId: schema.issueComment.issueId }).from(schema.issueComment).where(eq(schema.issueComment.id, commentId));
  return row ?? null;
}
