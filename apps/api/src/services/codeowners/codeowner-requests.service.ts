import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { errorMessage } from '../../lib/error-message.js';
import type { StoredEvent } from '../../lib/events/events.js';
import { listDiffFiles } from '../../lib/git/diff/diff.js';
import { PullRequestsService } from '../../resources/pull-requests/pull-requests.service.js';
import { ReviewRequestsService } from '../../resources/pull-requests/review-requests.service.js';
import { CodeownersService } from './codeowners.service.js';

/** Requests reviews from the code owners of an open, ready pull request's changed files, skipping anyone ever requested on it. */
@Injectable()
export class CodeownerRequestsService {
  private readonly logger = new Logger(CodeownerRequestsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly codeowners: CodeownersService,
    private readonly pullRequests: PullRequestsService,
    private readonly reviewRequests: ReviewRequestsService,
  ) {}

  /** Never throws: a broken CODEOWNERS file must not send the event round again. */
  async handle(event: StoredEvent) {
    if (
      event.type !== 'issue.opened' &&
      event.type !== 'pull_request.ready_for_review' &&
      event.type !== 'pull_request.synchronized'
    )
      return;
    try {
      await this.request(event.payload.issueId);
    } catch (error) {
      this.logger.warn(
        `Code-owner requests for event ${event.id} (${event.type}) failed: ${errorMessage(error)}`,
      );
    }
  }

  private async request(issueId: string) {
    const git = await this.pullRequests.openReady(issueId);
    if (!git?.mergeBase) return;
    // The base branch's file, never the head's: a pull request must not pick its own reviewers.
    const loaded = await this.codeowners.load(
      git.base,
      git.baseDirectory,
      git.baseSha,
    );
    if (!loaded) return;
    const files = await listDiffFiles({
      gitDir: git.baseDirectory,
      alternates: git.alternates,
      from: git.mergeBase,
      to: git.headSha,
    });
    const owners = files.flatMap((file) =>
      this.codeowners.ownersOf(loaded, file.path),
    );

    await this.db.transaction(async (tx) => {
      // Cleared rows count too: an owner who reviewed, or whose request was removed by hand, is not asked again.
      const asked = new Set(
        (
          await tx
            .select({
              userId: schema.pullRequestReviewRequest.reviewerUserId,
              teamId: schema.pullRequestReviewRequest.reviewerTeamId,
            })
            .from(schema.pullRequestReviewRequest)
            .where(
              eq(
                schema.pullRequestReviewRequest.pullRequestId,
                git.pullRequest.id,
              ),
            )
        ).flatMap((row) => row.userId ?? row.teamId ?? []),
      );
      await this.reviewRequests.addRequests(tx, {
        pullRequestId: git.pullRequest.id,
        issueId,
        repositoryId: git.base.id,
        authorId: git.pullRequest.authorId,
        // GitHub credits automatic requests to the author, whoever pushed.
        actorId: git.pullRequest.authorId,
        userIds: owners.flatMap((owner) =>
          owner.kind === 'user' && !asked.has(owner.userId)
            ? [owner.userId]
            : [],
        ),
        teamIds: owners.flatMap((owner) =>
          owner.kind === 'team' && !asked.has(owner.teamId)
            ? [owner.teamId]
            : [],
        ),
        asCodeOwner: true,
      });
    });
  }
}
