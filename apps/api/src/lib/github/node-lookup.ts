import { type Database, schema } from '@ghost/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { isoTimestamp } from '../db/sql.js';

/** The repository and number behind an issue's Ghost id, or null. */
export async function issueRefOf(db: Database, issueId: string) {
  const [row] = await db
    .select({
      repositoryId: schema.issue.repositoryId,
      number: schema.issue.number,
    })
    .from(schema.issue)
    .where(eq(schema.issue.id, issueId));
  return row ?? null;
}

/** A comment with its author's username and the issue it belongs to, or null. */
export async function commentOf(db: Database, commentId: string) {
  const [row] = await db
    .select({
      issueId: schema.issueComment.issueId,
      id: schema.issueComment.id,
      body: schema.issueComment.body,
      createdAt: isoTimestamp(schema.issueComment.createdAt),
      updatedAt: isoTimestamp(schema.issueComment.updatedAt),
      authorUsername: sql<string>`coalesce(${schema.user.username}, '')`,
    })
    .from(schema.issueComment)
    .innerJoin(schema.user, eq(schema.user.id, schema.issueComment.authorId))
    .where(eq(schema.issueComment.id, commentId));
  return row ?? null;
}

/** Label names by id, for ids within one repository; ids from another repository are left out. */
export async function labelNamesOf(
  db: Database,
  repositoryId: string,
  labelIds: string[],
) {
  if (labelIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: schema.label.id, name: schema.label.name })
    .from(schema.label)
    .where(
      and(
        eq(schema.label.repositoryId, repositoryId),
        inArray(schema.label.id, labelIds),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Usernames by user id; unknown ids, and users without a username, are left out. */
export async function usernamesOf(db: Database, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: schema.user.id, username: schema.user.username })
    .from(schema.user)
    .where(inArray(schema.user.id, userIds));
  return new Map(
    rows.flatMap((row) =>
      row.username ? [[row.id, row.username] as const] : [],
    ),
  );
}
