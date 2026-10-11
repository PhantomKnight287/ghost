import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, eq, isNotNull, isNull, or } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { orNull } from '../../../lib/github/authorize.js';
import {
  pullRequestRowsOf,
  reviewsOf,
  usersByEmailOf,
} from '../../../lib/github/node-lookup.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import {
  type PullRestDetail,
  type RestRepositoryObject,
  toPullRest,
  toRepositoryRest,
  toReviewRest,
  toUserRest,
} from '../../../lib/github/rest.js';
import type { IssueDTO } from '../../../resources/issues/dto/issue.dto.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import { PullRequestsService } from '../../../resources/pull-requests/pull-requests.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { RepositoryResolver } from '../../graphql/resolvers/repository/repository.resolver.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import { GithubIssuesService } from '../issues/issues.service.js';

/** GitHub's REST pull requests over IssuesService and PullRequestsService: an issue's fields plus its pull_request row, branches and repositories. */
@Injectable()
export class GithubPullsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubIssuesService,
    private readonly issues: IssuesService,
    private readonly pulls: PullRequestsService,
    private readonly repositories: RepositoryResolver,
    private readonly config: ConfigService,
  ) {}

  /** The issue behind a pull request number; 404 for an issue, as GitHub answers `/pulls/:number` for one. */
  async issue(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    number: number,
  ) {
    const issue = await this.issues.getIssue({
      ...this.github.ref(repository, viewer),
      number,
    });
    if (!issue.isPullRequest) throw new NotFoundException();
    return issue;
  }

  /** REST pull requests for issues that are all pull requests, in order. */
  async list(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    issues: IssueDTO[],
    detail?: PullRestDetail,
  ) {
    const ids = issues.map((issue) => issue.id);
    const [rows, extras] = await Promise.all([
      pullRequestRowsOf(this.db, ids),
      this.github.issueExtras(ids),
    ]);
    const origins = githubOrigins(this.config);
    const base = toRepositoryRest(repository, origins);
    const heads = new Map<string, RestRepositoryObject | null>([
      [repository.ghostId, base],
    ]);
    for (const row of rows.values())
      if (row.headRepositoryId && !heads.has(row.headRepositoryId)) {
        const head = await orNull(
          this.repositories.load(row.headRepositoryId, viewer),
        );
        heads.set(
          row.headRepositoryId,
          head && toRepositoryRest(head, origins),
        );
      }
    const context = await this.github.context(repository, {
      logins: [
        ...issues.flatMap((issue) => [
          issue.authorUsername,
          ...issue.assignees,
          ...(issue.closedByUsername ? [issue.closedByUsername] : []),
        ]),
        ...[...heads.values()].flatMap((head) =>
          head ? [head.owner.login] : [],
        ),
      ],
      labels: issues.flatMap((issue) => issue.labels),
    });
    const baseTip = new Map<string, string | null>();
    return Promise.all(
      issues.map(async (issue) => {
        const row = rows.get(issue.id)!;
        if (!baseTip.has(row.baseRef))
          baseTip.set(
            row.baseRef,
            await this.pulls.branchTip(row.baseRepositoryId, row.baseRef),
          );
        // The stored head is only refreshed on merge, so an open request reads its branch.
        const headSha =
          (row.state === 'open' &&
            (await this.pulls.branchTip(row.headRepositoryId, row.headRef))) ||
          row.headSha;
        return toPullRest(
          issue,
          {
            numericId: extras.get(issue.id)!.numericId,
            state: row.state,
            draft: row.draft,
            baseRef: row.baseRef,
            headRef: row.headRef,
            headSha,
            baseSha: baseTip.get(row.baseRef) ?? null,
            mergeCommitSha: row.mergeCommitSha,
            mergedAt: row.mergedAt,
            base,
            head: row.headRepositoryId
              ? (heads.get(row.headRepositoryId) ?? null)
              : null,
          },
          context,
          detail,
        );
      }),
    );
  }

  /** One pull request with the merge state and counts only GitHub's single-pull response carries. */
  async one(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    number: number,
  ) {
    const issue = await this.issue(repository, viewer, number);
    const pull = await this.pulls.getPullRequest({
      ...this.github.ref(repository, viewer),
      number,
    });
    const open = pull.state === 'open';
    const conflicted = open && pull.conflicts.length > 0;
    const [rest] = await this.list(repository, viewer, [issue], {
      mergeable: !open
        ? null
        : conflicted
          ? false
          : pull.mergeBase !== null && pull.mergeBase !== pull.headSha
            ? true
            : null,
      conflicted,
      commits: pull.commitCount,
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changedFiles,
      reviewComments: await this.reviewCommentCount(pull.id),
    });
    return rest!;
  }

  /** A pull request's submitted reviews, oldest first. */
  async reviews(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    number: number,
  ) {
    await this.issue(repository, viewer, number);
    const { pullRequest } = await this.pulls.load({
      ...this.github.ref(repository, viewer),
      number,
    });
    const rows = await reviewsOf(this.db, [pullRequest.id]);
    const context = await this.github.context(repository, {
      logins: rows.map((row) => row.authorLogin),
      labels: [],
    });
    return rows.map((row) => toReviewRest(row, number, context));
  }

  /** The accounts behind commit emails, as GitHub's simple-user, keyed by lowercased email. */
  async commitUsers(emails: string[]) {
    const origins = githubOrigins(this.config);
    const found = await usersByEmailOf(this.db, emails);
    return new Map(
      [...found].flatMap(([email, row]) =>
        row.username
          ? [
              [
                email,
                toUserRest(
                  {
                    ghostId: row.id,
                    numericId: row.numericId,
                    login: row.username,
                    avatarUrl: row.image,
                  },
                  origins,
                ),
              ] as const,
            ]
          : [],
      ),
    );
  }

  /** Line comments others can see: those in a submitted review, and replies. */
  private async reviewCommentCount(pullRequestId: string) {
    const [row] = await this.db
      .select({ total: count() })
      .from(schema.pullRequestReviewComment)
      .leftJoin(
        schema.pullRequestReview,
        eq(
          schema.pullRequestReview.id,
          schema.pullRequestReviewComment.reviewId,
        ),
      )
      .where(
        and(
          eq(schema.pullRequestReviewComment.pullRequestId, pullRequestId),
          or(
            isNull(schema.pullRequestReviewComment.reviewId),
            isNotNull(schema.pullRequestReview.submittedAt),
          ),
        ),
      );
    return row?.total ?? 0;
  }
}
