import { schema } from '@ghost/db';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import type { Executor } from '../db/executor.js';

/** Who a review is wanted from: a user, `direct` false also counting requests to the user's teams, or one team. */
export type ReviewRequested =
  | { userId: string; direct: boolean }
  | { teamId: string };

/** Pending `pull_request_review_request` rows asking `wanted` for a review; the caller correlates them with its pull request. */
export function pendingReviewRequestFor(db: Executor, wanted: ReviewRequested) {
  return and(
    isNull(schema.pullRequestReviewRequest.clearedAt),
    'teamId' in wanted
      ? eq(schema.pullRequestReviewRequest.reviewerTeamId, wanted.teamId)
      : or(
          eq(schema.pullRequestReviewRequest.reviewerUserId, wanted.userId),
          wanted.direct
            ? undefined
            : inArray(
                schema.pullRequestReviewRequest.reviewerTeamId,
                db
                  .select({ id: schema.teamMember.teamId })
                  .from(schema.teamMember)
                  .where(eq(schema.teamMember.userId, wanted.userId)),
              ),
        ),
  );
}
