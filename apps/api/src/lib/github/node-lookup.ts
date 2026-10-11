import { type Database, schema } from '@ghost/db';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { isoTimestamp } from '../db/sql.js';
import type { UserRow } from './nodes.js';

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

/** The pull_request rows behind issue ids, keyed by issue id; issues that are not pull requests are left out. */
export async function pullRequestRowsOf(db: Database, issueIds: string[]) {
  if (issueIds.length === 0) return new Map<string, PullRequestRow>();
  const rows = await db
    .select({
      issueId: schema.pullRequest.issueId,
      id: schema.pullRequest.id,
      state: schema.pullRequest.state,
      draft: schema.pullRequest.draft,
      baseRepositoryId: schema.pullRequest.baseRepositoryId,
      baseRef: schema.pullRequest.baseRef,
      headRepositoryId: schema.pullRequest.headRepositoryId,
      headRef: schema.pullRequest.headRef,
      headSha: schema.pullRequest.headSha,
      mergeCommitSha: schema.pullRequest.mergeCommitSha,
      mergedAt: schema.pullRequest.mergedAt,
    })
    .from(schema.pullRequest)
    .where(inArray(schema.pullRequest.issueId, issueIds));
  return new Map(rows.map((row) => [row.issueId, row]));
}

export type PullRequestRow = Pick<
  typeof schema.pullRequest.$inferSelect,
  | 'issueId'
  | 'id'
  | 'state'
  | 'draft'
  | 'baseRepositoryId'
  | 'baseRef'
  | 'headRepositoryId'
  | 'headRef'
  | 'headSha'
  | 'mergeCommitSha'
  | 'mergedAt'
>;

/** The accounts behind commit author emails, keyed by the lowercased email. Only verified addresses count, as on GitHub, so nobody claims another's commits by adding their address. */
export async function usersByEmailOf(db: Database, emails: string[]) {
  const wanted = [...new Set(emails.map((email) => email.toLowerCase()))];
  if (wanted.length === 0) return new Map<string, UserRow>();
  const [primaries, extras] = await Promise.all([
    db
      .select()
      .from(schema.user)
      .where(
        and(
          inArray(sql`lower(${schema.user.email})`, wanted),
          eq(schema.user.emailVerified, true),
        ),
      ),
    db
      .select({ email: schema.userEmail.email, user: schema.user })
      .from(schema.userEmail)
      .innerJoin(schema.user, eq(schema.user.id, schema.userEmail.userId))
      .where(
        and(
          inArray(sql`lower(${schema.userEmail.email})`, wanted),
          eq(schema.userEmail.verified, true),
        ),
      ),
  ]);
  return new Map<string, UserRow>([
    ...extras.map((row) => [row.email.toLowerCase(), row.user] as const),
    ...primaries.map((row) => [row.email.toLowerCase(), row] as const),
  ]);
}

/** Submitted reviews of pull_request ids, oldest first; a pending review is its author's alone. */
export function reviewsOf(db: Database, pullRequestIds: string[]) {
  return db
    .select({
      id: schema.pullRequestReview.id,
      numericId: schema.pullRequestReview.numericId,
      pullRequestId: schema.pullRequestReview.pullRequestId,
      authorLogin: sql<string>`coalesce(${schema.user.username}, '')`,
      state: schema.pullRequestReview.state,
      body: schema.pullRequestReview.body,
      commitSha: schema.pullRequestReview.commitSha,
      dismissed: sql<boolean>`${schema.pullRequestReview.dismissalMessage} is not null`,
      createdAt: schema.pullRequestReview.createdAt,
      submittedAt: schema.pullRequestReview.submittedAt,
    })
    .from(schema.pullRequestReview)
    .innerJoin(
      schema.user,
      eq(schema.user.id, schema.pullRequestReview.authorId),
    )
    .where(
      and(
        inArray(schema.pullRequestReview.pullRequestId, pullRequestIds),
        isNotNull(schema.pullRequestReview.submittedAt),
      ),
    )
    .orderBy(
      asc(schema.pullRequestReview.submittedAt),
      asc(schema.pullRequestReview.id),
    );
}
