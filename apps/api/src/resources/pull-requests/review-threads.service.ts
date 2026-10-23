import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { publishEvent } from '../../lib/events/events.js';
import {
  ReviewCommentNotFoundError,
  ReviewThreadReplyError,
} from '../../lib/pull-requests/pull-requests.errors.js';
import { canResolveThreads } from '../../lib/pull-requests/reviews.js';
import { RepositoryForbiddenError } from '../../lib/repositories/access/repository-access.errors.js';
import {
  type PullRequestRef,
  PullRequestsService,
} from './pull-requests.service.js';

/** A thread is its first comment, which carries the resolution; replies only join it. */
@Injectable()
export class ReviewThreadsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly pullRequests: PullRequestsService,
  ) {}

  /** Resolving a resolved thread, or reopening an open one, changes nothing and records nothing. */
  async resolve(
    params: PullRequestRef & {
      requesterId: string;
      commentId: string;
      resolved: boolean;
    },
  ) {
    const { pullRequest, base } = await this.pullRequests.load(params);
    const [thread] = await this.db
      .select({ inReplyToId: schema.pullRequestReviewComment.inReplyToId })
      .from(schema.pullRequestReviewComment)
      .innerJoin(
        schema.pullRequestReview,
        eq(
          schema.pullRequestReview.id,
          schema.pullRequestReviewComment.reviewId,
        ),
      )
      .where(
        and(
          eq(schema.pullRequestReviewComment.id, params.commentId),
          eq(schema.pullRequestReviewComment.pullRequestId, pullRequest.id),
          isNotNull(schema.pullRequestReview.submittedAt),
        ),
      );
    if (!thread) throw new ReviewCommentNotFoundError();
    if (thread.inReplyToId !== null) throw new ReviewThreadReplyError();
    if (
      !canResolveThreads(
        base.viewerRole,
        pullRequest.authorId === params.requesterId,
      )
    ) {
      throw new RepositoryForbiddenError();
    }

    await this.db.transaction(async (tx) => {
      const [changed] = await tx
        .update(schema.pullRequestReviewComment)
        .set(
          params.resolved
            ? { resolvedById: params.requesterId, resolvedAt: new Date() }
            : { resolvedById: null, resolvedAt: null },
        )
        .where(
          and(
            eq(schema.pullRequestReviewComment.id, params.commentId),
            params.resolved
              ? isNull(schema.pullRequestReviewComment.resolvedAt)
              : isNotNull(schema.pullRequestReviewComment.resolvedAt),
          ),
        )
        .returning({ id: schema.pullRequestReviewComment.id });
      if (!changed) return;
      await publishEvent(tx, {
        type: params.resolved
          ? 'pull_request_review_thread.resolved'
          : 'pull_request_review_thread.unresolved',
        repositoryId: base.id,
        actorId: params.requesterId,
        payload: { issueId: pullRequest.issueId, commentId: params.commentId },
      });
    });

    const [state] = await this.db
      .select({
        resolved: sql<boolean>`${schema.pullRequestReviewComment.resolvedAt} is not null`,
        resolvedBy: sql<{
          username: string;
        } | null>`case when ${schema.user.id} is null then null else json_build_object('username', coalesce(${schema.user.username}, '')) end`,
      })
      .from(schema.pullRequestReviewComment)
      .leftJoin(
        schema.user,
        eq(schema.user.id, schema.pullRequestReviewComment.resolvedById),
      )
      .where(eq(schema.pullRequestReviewComment.id, params.commentId));
    if (!state) throw new ReviewCommentNotFoundError();
    return state;
  }
}
