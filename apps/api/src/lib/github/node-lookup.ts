import { type Database, schema } from '@ghost/db';
import { and, eq, inArray } from 'drizzle-orm';

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

/** Label names for label ids within one repository, in the order given; ids from another repository are dropped. */
export async function labelNamesOf(db: Database, repositoryId: string, labelIds: string[]) {
  if (labelIds.length === 0) return [];
  const rows = await db.select({ id: schema.label.id, name: schema.label.name }).from(schema.label).where(and(eq(schema.label.repositoryId, repositoryId), inArray(schema.label.id, labelIds)));
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return labelIds.flatMap((id) => byId.get(id) ?? []);
}

/** Usernames for user ids, in the order given; unknown ids are dropped. */
export async function usernamesOf(db: Database, userIds: string[]) {
  if (userIds.length === 0) return [];
  const rows = await db.select({ id: schema.user.id, username: schema.user.username }).from(schema.user).where(inArray(schema.user.id, userIds));
  const byId = new Map(rows.map((row) => [row.id, row.username]));
  return userIds.flatMap((id) => byId.get(id) ?? []);
}
