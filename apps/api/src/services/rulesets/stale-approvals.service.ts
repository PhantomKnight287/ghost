import { type Database, schema } from '@ghost/db';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { DomainError } from '../../domain/errors.js';
import { errorMessage } from '../../lib/error-message.js';
import { publishEvent, type StoredEvent } from '../../lib/events/events.js';
import type { PullRequestRuleParameters } from '../../lib/rulesets/rulesets.types.js';
import { PullRequestsService } from '../../resources/pull-requests/pull-requests.service.js';
import { PullRequestRulesService } from './pull-request-rules.service.js';

// ponytail: Ghost's wording; GitHub's own dismissal message takes a second account to record.
const STALE_DISMISSAL_MESSAGE =
  'This approval was dismissed because new changes were made to the pull request.';

/** Writes down the approvals `dismiss_stale_reviews_on_push` no longer counts, so the conversation shows them dismissed. A merge judges staleness itself and never waits on this. */
@Injectable()
export class StaleApprovalsService {
  private readonly logger = new Logger(StaleApprovalsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly pullRequests: PullRequestsService,
    private readonly rules: PullRequestRulesService,
  ) {}

  /** A pull request whose head is gone by then is logged and let through; any other failure throws so the outbox tries again. Only a push to the head can change what was approved: GitHub leaves approvals standing when the base moves on. */
  async handle(event: StoredEvent) {
    if (event.type !== 'pull_request.synchronized') return;
    try {
      await this.dismiss(event.payload.issueId);
    } catch (error) {
      if (
        !(error instanceof DomainError && error.status === HttpStatus.NOT_FOUND)
      ) {
        throw error;
      }
      this.logger.warn(
        `Stale approvals for event ${event.id} (${event.type}) were not dismissed: ${errorMessage(error)}`,
      );
    }
  }

  private async dismiss(issueId: string) {
    // One query decides, so a repository that never dismisses runs no git command for every push.
    const [dismisses] = await this.db
      .select({ id: schema.ruleset.id })
      .from(schema.pullRequest)
      .innerJoin(
        schema.ruleset,
        and(
          eq(schema.ruleset.repositoryId, schema.pullRequest.baseRepositoryId),
          eq(schema.ruleset.enforcement, 'active'),
        ),
      )
      .innerJoin(
        schema.rulesetRule,
        and(
          eq(schema.rulesetRule.rulesetId, schema.ruleset.id),
          eq(schema.rulesetRule.type, 'pull_request'),
          sql`${schema.rulesetRule.parameters}->>'dismiss_stale_reviews_on_push' = 'true'`,
        ),
      )
      .where(eq(schema.pullRequest.issueId, issueId))
      .limit(1);
    if (!dismisses) return;
    // Drafts too: GitHub dismisses on the push, whatever the pull request's state.
    const git = await this.pullRequests.openReady(issueId, { drafts: true });
    if (!git) return;
    const { pullRequestRules } = await this.rules.applicable(
      git.base,
      git.baseDirectory,
      git.pullRequest.baseRef,
    );
    // An evaluate ruleset only records what it would do; dismissing an approval is doing it.
    const dismissing = pullRequestRules.some(
      (ruleset) =>
        ruleset.enforcement === 'active' &&
        ruleset.rules.some(
          (rule) =>
            rule.type === 'pull_request' &&
            (rule.parameters as PullRequestRuleParameters)
              .dismiss_stale_reviews_on_push,
        ),
    );
    if (!dismissing) return;
    const stale = await this.rules.staleApprovals(git);
    if (stale.length === 0) return;

    await this.db.transaction(async (tx) => {
      // A null dismisser marks the dismissal as the system's.
      const dismissed = await tx
        .update(schema.pullRequestReview)
        .set({ dismissalMessage: STALE_DISMISSAL_MESSAGE })
        .where(
          and(
            inArray(schema.pullRequestReview.id, stale),
            isNull(schema.pullRequestReview.dismissalMessage),
          ),
        )
        .returning({ id: schema.pullRequestReview.id });
      for (const { id } of dismissed) {
        await publishEvent(tx, {
          type: 'pull_request.review_dismissed',
          repositoryId: git.base.id,
          actorId: null,
          payload: { issueId, reviewId: id },
        });
      }
    });
  }
}
