import { schema } from '@ghost/db';
import { atLeast, type Role } from '@ghost/permissions';
import { and, eq, isNotNull, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { type ViaApp, viaAppOf } from '../apps/via-app.js';
import { isoTimestamp } from '../db/sql.js';
import type { Executor } from '../db/executor.js';

type DiffSide = (typeof schema.diffSide.enumValues)[number];

export interface ReviewReply {
  id: string;
  body: string;
  authorUsername: string;
  authorImage: string | null;
  viaApp: ViaApp | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewThread extends ReviewReply {
  path: string;
  side: DiffSide;
  line: number;
  startSide: DiffSide | null;
  startLine: number | null;
  commitSha: string;
  diffHunk: string | null;
  resolved: boolean;
  resolvedBy: { username: string } | null;
  replies: ReviewReply[];
}

const thread = alias(schema.pullRequestReviewComment, 'thread');
const threadAuthor = alias(schema.user, 'thread_author');
const resolver = alias(schema.user, 'resolver');
const reply = alias(schema.pullRequestReviewComment, 'reply');
const replyAuthor = alias(schema.user, 'reply_author');
const reviewAuthor = alias(schema.user, 'review_author');
const dismisser = alias(schema.user, 'dismisser');

const replies = sql`(select coalesce(json_agg(json_build_object('id', ${reply.id}, 'body', ${reply.body}, 'authorUsername', coalesce(${replyAuthor.username}, ''), 'authorImage', ${replyAuthor.image}, 'viaApp', ${viaAppOf(reply.viaAppId)}, 'createdAt', ${isoTimestamp(reply.createdAt)}, 'updatedAt', ${isoTimestamp(reply.updatedAt)}) order by ${reply.createdAt}, ${reply.id}), '[]') from ${schema.pullRequestReviewComment} ${reply} join ${schema.user} ${replyAuthor} on ${replyAuthor.id} = ${reply.authorId} where ${reply.inReplyToId} = ${thread.id})`;

const threads = sql<
  ReviewThread[]
>`(select coalesce(json_agg(json_build_object('id', ${thread.id}, 'path', ${thread.path}, 'side', ${thread.side}, 'line', ${thread.line}, 'startSide', ${thread.startSide}, 'startLine', ${thread.startLine}, 'commitSha', ${thread.commitSha}, 'diffHunk', ${thread.diffHunk}, 'body', ${thread.body}, 'authorUsername', coalesce(${threadAuthor.username}, ''), 'authorImage', ${threadAuthor.image}, 'viaApp', ${viaAppOf(thread.viaAppId)}, 'createdAt', ${isoTimestamp(thread.createdAt)}, 'updatedAt', ${isoTimestamp(thread.updatedAt)}, 'resolved', ${thread.resolvedAt} is not null, 'resolvedBy', case when ${resolver.id} is null then null else json_build_object('username', coalesce(${resolver.username}, '')) end, 'replies', ${replies}) order by ${thread.path}, ${thread.line}, ${thread.createdAt}), '[]') from ${schema.pullRequestReviewComment} ${thread} join ${schema.user} ${threadAuthor} on ${threadAuthor.id} = ${thread.authorId} left join ${schema.user} ${resolver} on ${resolver.id} = ${thread.resolvedById} where ${thread.reviewId} = ${schema.pullRequestReview.id} and ${thread.inReplyToId} is null)`;

/** Submitted reviews, and with `viewerId` that viewer's pending one; a line comment is visible with its review. */
export const visibleReview = (viewerId?: string) =>
  or(
    isNotNull(schema.pullRequestReview.submittedAt),
    viewerId ? eq(schema.pullRequestReview.authorId, viewerId) : undefined,
  );

// A reply's own review says nothing beyond the reply, which its thread already shows.
const notReplyOnly = sql`(${schema.pullRequestReview.state} is distinct from 'commented' or ${schema.pullRequestReview.body} is not null or exists (select 1 from ${schema.pullRequestReviewComment} where ${schema.pullRequestReviewComment.reviewId} = ${schema.pullRequestReview.id} and ${schema.pullRequestReviewComment.inReplyToId} is null))`;

// A pending review has not been submitted, so it is dated by when it was started.
const submittedAt = sql`coalesce(${schema.pullRequestReview.submittedAt}, ${schema.pullRequestReview.createdAt})`;

/** Reviews exactly as the conversation renders them, oldest first: each line comment is a thread carrying its replies, and a reply's own review is left out. */
export function selectReviews(db: Executor, where: SQL | undefined) {
  return db
    .select({
      kind: sql<'review'>`'review'`,
      id: schema.pullRequestReview.id,
      state: schema.pullRequestReview.state,
      body: schema.pullRequestReview.body,
      authorUsername: sql<string>`coalesce(${reviewAuthor.username}, '')`,
      authorImage: reviewAuthor.image,
      viaApp: viaAppOf(schema.pullRequestReview.viaAppId),
      commitSha: schema.pullRequestReview.commitSha,
      dismissedByUsername: dismisser.username,
      dismissalMessage: schema.pullRequestReview.dismissalMessage,
      comments: threads,
      createdAt: isoTimestamp(submittedAt),
    })
    .from(schema.pullRequestReview)
    .innerJoin(
      schema.pullRequest,
      eq(schema.pullRequest.id, schema.pullRequestReview.pullRequestId),
    )
    .innerJoin(
      reviewAuthor,
      eq(reviewAuthor.id, schema.pullRequestReview.authorId),
    )
    .leftJoin(
      dismisser,
      eq(dismisser.id, schema.pullRequestReview.dismissedById),
    )
    .where(and(where, notReplyOnly))
    .orderBy(submittedAt, schema.pullRequestReview.id);
}

/** The pull request's author resolves threads on it, as does anyone with `write`. */
export function canResolveThreads(role: Role | null, isAuthor: boolean) {
  return isAuthor || atLeast(role, 'write');
}
