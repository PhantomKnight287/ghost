import { schema } from '@ghost/db';
import { eq, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { isoTimestamp } from '../../utils/index.js';
import type { Executor } from '../issues/close-issue.js';

type DiffSide = (typeof schema.diffSide.enumValues)[number];

export interface ReviewReply {
  id: string;
  body: string;
  authorUsername: string;
  authorImage: string | null;
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
  replies: ReviewReply[];
}

const thread = alias(schema.pullRequestReviewComment, 'thread');
const threadAuthor = alias(schema.user, 'thread_author');
const reply = alias(schema.pullRequestReviewComment, 'reply');
const replyAuthor = alias(schema.user, 'reply_author');
const reviewAuthor = alias(schema.user, 'review_author');
const dismisser = alias(schema.user, 'dismisser');

const replies = sql`(select coalesce(json_agg(json_build_object('id', ${reply.id}, 'body', ${reply.body}, 'authorUsername', coalesce(${replyAuthor.username}, ''), 'authorImage', ${replyAuthor.image}, 'createdAt', ${isoTimestamp(reply.createdAt)}, 'updatedAt', ${isoTimestamp(reply.updatedAt)}) order by ${reply.createdAt}, ${reply.id}), '[]') from ${schema.pullRequestReviewComment} ${reply} join ${schema.user} ${replyAuthor} on ${replyAuthor.id} = ${reply.authorId} where ${reply.inReplyToId} = ${thread.id})`;

const threads = sql<
  ReviewThread[]
>`(select coalesce(json_agg(json_build_object('id', ${thread.id}, 'path', ${thread.path}, 'side', ${thread.side}, 'line', ${thread.line}, 'startSide', ${thread.startSide}, 'startLine', ${thread.startLine}, 'commitSha', ${thread.commitSha}, 'diffHunk', ${thread.diffHunk}, 'body', ${thread.body}, 'authorUsername', coalesce(${threadAuthor.username}, ''), 'authorImage', ${threadAuthor.image}, 'createdAt', ${isoTimestamp(thread.createdAt)}, 'updatedAt', ${isoTimestamp(thread.updatedAt)}, 'replies', ${replies}) order by ${thread.path}, ${thread.line}, ${thread.createdAt}), '[]') from ${schema.pullRequestReviewComment} ${thread} join ${schema.user} ${threadAuthor} on ${threadAuthor.id} = ${thread.authorId} where ${thread.reviewId} = ${schema.pullRequestReview.id})`;

// A pending review has not been submitted, so it is dated by when it was started.
const submittedAt = sql`coalesce(${schema.pullRequestReview.submittedAt}, ${schema.pullRequestReview.createdAt})`;

/** Reviews exactly as the conversation renders them, oldest first: each line comment is a thread carrying its replies. */
export function selectReviews(db: Executor, where: SQL | undefined) {
  return db
    .select({
      kind: sql<'review'>`'review'`,
      id: schema.pullRequestReview.id,
      state: schema.pullRequestReview.state,
      body: schema.pullRequestReview.body,
      authorUsername: sql<string>`coalesce(${reviewAuthor.username}, '')`,
      authorImage: reviewAuthor.image,
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
    .where(where)
    .orderBy(submittedAt, schema.pullRequestReview.id);
}
