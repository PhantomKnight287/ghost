import type { Readable } from 'node:stream';

import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { orNull } from '../../../lib/github/authorize.js';
import {
  GithubConflictError,
  GithubNotFoundError,
  NotMergeableError,
  UnprocessableError,
} from '../../../lib/github/github.errors.js';
import { mergeStateOf } from '../../../lib/github/merge-state.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';
import {
  pullRequestRowsOf,
  usersByEmailOf,
} from '../../../lib/github/node-lookup.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import {
  type PullRestDetail,
  pageOf,
  RestPage,
  type RestRepositoryObject,
  toPullRest,
  toRepositoryRest,
  toUserRest,
} from '../../../lib/github/rest.js';
import {
  NothingToMergeError,
  PullRequestConflictError,
  PullRequestDraftError,
  PullRequestNotOpenError,
} from '../../../lib/pull-requests/pull-requests.errors.js';
import { visibleReview } from '../../../lib/pull-requests/reviews.js';
import { RulesetViolationError } from '../../../lib/rulesets/rulesets.errors.js';
import type { IssueDTO } from '../../../resources/issues/dto/issue.dto.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import { PullRequestsService } from '../../../resources/pull-requests/pull-requests.service.js';
import { ReviewRequestsService } from '../../../resources/pull-requests/review-requests.service.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import type { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import type {
  GithubCreatePullDTO,
  GithubListPullsQueryDTO,
  GithubMergePullDTO,
  GithubMergeResultDTO,
  GithubPullCommitDTO,
  GithubPullFileDTO,
  GithubRequestedReviewersDTO,
  GithubRequestedReviewersResponseDTO,
  GithubUpdatePullDTO,
} from './dto/pull.dto.js';

// ponytail: a pull request's commits are listed in one page of this many, as GitHub caps the route at 250.
const MAX_COMMITS = 250;

const FILE_STATUS: Record<string, string> = {
  A: 'added',
  D: 'removed',
  M: 'modified',
  T: 'changed',
};

/** GitHub's REST pull requests over IssuesService and PullRequestsService: an issue's fields plus its pull_request row, branches and repositories. */
@Injectable()
export class GithubPullsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubIssuesService,
    private readonly issues: IssuesService,
    private readonly pulls: PullRequestsService,
    private readonly reviewRequests: ReviewRequestsService,
    private readonly repositories: RepositoryNodesService,
    private readonly config: ConfigService,
  ) {}

  /** `head` is GitHub's `owner:branch`, or a bare branch from any owner. */
  async listPulls(
    { owner, repo, viewer }: GithubRepositoryTarget,
    query: GithubListPullsQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const state = query.state ?? 'open';
    const colon = query.head?.indexOf(':') ?? -1;
    const list = await this.issues.getIssues(
      {
        ...this.github.ref(repository, viewer),
        query: {
          state: 'all',
          sort: query.sort === 'updated' ? 'updated' : 'created',
          direction: query.direction,
          limit: page.perPage,
        },
      },
      {
        offset: page.offset,
        pullRequests: {
          states:
            state === 'open'
              ? ['open']
              : state === 'closed'
                ? ['closed', 'merged']
                : undefined,
          ...(query.head &&
            (colon < 0
              ? { headRef: query.head }
              : {
                  headOwner: query.head.slice(0, colon),
                  headRef: query.head.slice(colon + 1) || undefined,
                })),
          baseRef: query.base,
        },
      },
    );
    return new RestPage(
      await this.rest(repository, viewer, list.issues),
      page,
      list.total,
    );
  }

  async createPull(
    { owner, repo, viewer }: GithubRepositoryTarget,
    body: GithubCreatePullDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/pulls',
    );
    const forkOwner = body.head_repo?.split('/')[0];
    const created = await this.pulls.createPullRequest({
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: signedIn.userId,
      body: {
        title: body.title,
        body: body.body,
        base: body.base,
        head:
          forkOwner && !body.head.includes(':')
            ? `${forkOwner}:${body.head}`
            : body.head,
        draft: body.draft,
      },
    });
    return this.detailed(repository, signedIn, created.number);
  }

  async getPull(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.detailed(repository, viewer, number);
  }

  async listRequestedReviewers(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
  ): Promise<GithubRequestedReviewersResponseDTO> {
    const repository = await this.github.readable(owner, repo, viewer);
    const issue = await this.issue(repository, viewer, number);
    const [pull] = await this.rest(repository, viewer, [issue]);
    return { users: pull!.requested_reviewers, teams: pull!.requested_teams };
  }

  requestReviewers(
    target: GithubRepositoryTarget,
    number: number,
    body: GithubRequestedReviewersDTO,
  ) {
    return this.changeReviewers('request', target, number, body);
  }

  removeReviewers(
    target: GithubRepositoryTarget,
    number: number,
    body: GithubRequestedReviewersDTO,
  ) {
    return this.changeReviewers('remove', target, number, body);
  }

  private async changeReviewers(
    operation: 'request' | 'remove',
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    body: GithubRequestedReviewersDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      `${operation === 'request' ? 'POST' : 'DELETE'} /repos/:owner/:repo/pulls/:number/requested_reviewers`,
    );
    await this.reviewRequests[operation]({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      number,
      users: body.reviewers ?? [],
      teams: body.team_reviewers ?? [],
    });
    return this.detailed(repository, signedIn, number);
  }

  /** The diff as text, or with `mailbox` one mailbox-style patch per commit, as `gh pr diff` reads it. */
  async diff(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    mailbox: boolean,
  ): Promise<Readable> {
    const repository = await this.github.readable(owner, repo, viewer);
    await this.issue(repository, viewer, number);
    return this.pulls.streamPatch({
      ...this.github.ref(repository, viewer),
      number,
      mailbox,
    });
  }

  async updatePull(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    body: GithubUpdatePullDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/pulls/:number',
    );
    const ref = {
      ...this.github.ref(repository, signedIn),
      number,
      requesterId: signedIn.userId,
    };
    const current = await this.pulls.load(ref);
    if (body.base !== undefined && body.base !== current.pullRequest.baseRef)
      throw new UnprocessableError(
        'Ghost cannot change the base branch of a pull request',
      );
    if (body.title !== undefined || body.body !== undefined)
      await this.pulls.updatePullRequest({
        ...ref,
        body: { title: body.title, body: body.body },
      });
    // Setting the state a request already has is a no-op on GitHub; Ghost refuses it.
    const state = current.pullRequest.state;
    if (body.state === 'closed' && state === 'open')
      await this.pulls.closePullRequest(ref);
    if (body.state === 'open' && state === 'closed')
      await this.pulls.reopenPullRequest(ref);
    if (body.state === 'open' && state === 'merged')
      throw new UnprocessableError(
        'state cannot be changed. The pull request cannot be reopened.',
      );
    return this.detailed(repository, signedIn, number);
  }

  async commits(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    await this.issue(repository, viewer, number);
    const page = pageOf(query);
    const { commits, total } = await this.pulls.getCommits({
      ...this.github.ref(repository, viewer),
      number,
      limit: MAX_COMMITS,
      oldestFirst: true,
    });
    const users = await this.commitUsers(
      commits.flatMap((commit) => [commit.authorEmail, commit.committerEmail]),
    );
    const userOf = (email: string) => users.get(email.toLowerCase()) ?? null;
    const apiUrl = `${githubOrigins(this.config).api}/api/v3/repos/${repository.nameWithOwner}`;
    return new RestPage<GithubPullCommitDTO>(
      commits.slice(page.offset, page.offset + page.perPage).map((commit) => ({
        sha: commit.sha,
        node_id: encodeNodeId('Commit', `${repository.ghostId}:${commit.sha}`),
        commit: {
          author: {
            name: commit.authorName,
            email: commit.authorEmail,
            date: commit.authoredAt,
          },
          committer: {
            name: commit.committerName,
            email: commit.committerEmail,
            date: commit.committedAt,
          },
          message: [commit.subject, commit.body].filter(Boolean).join('\n\n'),
          url: `${apiUrl}/git/commits/${commit.sha}`,
          comment_count: 0,
          verification: {
            verified: commit.verification?.verified ?? false,
            reason: commit.verification?.verified
              ? 'valid'
              : commit.verification?.keyId
                ? 'unknown_key'
                : 'unsigned',
            signature: null,
            payload: null,
            verified_at: null,
          },
        },
        url: `${apiUrl}/commits/${commit.sha}`,
        html_url: `${repository.url}/commit/${commit.sha}`,
        comments_url: `${apiUrl}/commits/${commit.sha}/comments`,
        author: userOf(commit.authorEmail),
        committer: userOf(commit.committerEmail),
      })),
      page,
      Math.min(total, MAX_COMMITS),
    );
  }

  async files(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    await this.issue(repository, viewer, number);
    const page = pageOf(query);
    const { to, files } = await this.pulls.getFiles({
      ...this.github.ref(repository, viewer),
      number,
    });
    return new RestPage<GithubPullFileDTO>(
      files.slice(page.offset, page.offset + page.perPage).map((file) => ({
        filename: file.path,
        status: FILE_STATUS[file.status] ?? 'modified',
        additions: file.additions,
        deletions: file.deletions,
        changes: file.additions + file.deletions,
        blob_url: `${repository.url}/blob/${to}/${file.path}`,
        raw_url: `${repository.url}/raw/${to}/${file.path}`,
      })),
      page,
      files.length,
    );
  }

  /** Resolves when merged; 404 otherwise, as GitHub answers. */
  async merged(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const { pullRequest } = await this.pulls.load({
      ...this.github.ref(repository, viewer),
      number,
    });
    if (pullRequest.state !== 'merged') throw new GithubNotFoundError();
  }

  async merge(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    body: GithubMergePullDTO,
  ): Promise<GithubMergeResultDTO> {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PUT /repos/:owner/:repo/pulls/:number/merge',
    );
    const ref = {
      ...this.github.ref(repository, signedIn),
      number,
      requesterId: signedIn.userId,
    };
    if (body.sha) {
      // ponytail: checked before the merge, not under its lock; a push landing in between merges the newer head.
      const { headSha } = await this.pulls.getPullRequest(ref);
      if (headSha !== body.sha)
        throw new GithubConflictError(
          'Head branch was modified. Review and try the merge again.',
        );
    }
    try {
      const { mergeCommitSha } = await this.pulls.mergePullRequest({
        ...ref,
        method: body.merge_method,
        title: body.commit_title || undefined,
        message: body.commit_message,
        compat: true,
      });
      return {
        sha: mergeCommitSha,
        merged: true,
        message: 'Pull Request successfully merged',
      };
    } catch (error) {
      if (
        error instanceof PullRequestConflictError ||
        error instanceof PullRequestDraftError ||
        error instanceof PullRequestNotOpenError ||
        error instanceof NothingToMergeError
      )
        throw new NotMergeableError();
      if (error instanceof RulesetViolationError)
        throw new NotMergeableError(error.message);
      throw error;
    }
  }

  /** The issue behind a pull request number; 404 for an issue, as GitHub answers `/pulls/:number` for one. */
  private async issue(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    number: number,
  ) {
    const issue = await this.issues.getIssue({
      ...this.github.ref(repository, viewer),
      number,
    });
    if (!issue.isPullRequest) throw new GithubNotFoundError();
    return issue;
  }

  /** REST pull requests for issues that are all pull requests, in order. */
  private async rest(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    issues: IssueDTO[],
    detail?: PullRestDetail,
  ) {
    const ids = issues.map((issue) => issue.id);
    const [rows, extras, reviewers] = await Promise.all([
      pullRequestRowsOf(this.db, ids),
      this.github.issueExtras(ids),
      // ponytail: one lookup per pull request, a batched query if a page of them gets slow.
      Promise.all(
        issues.map((issue) =>
          this.reviewRequests.list({
            ...this.github.ref(repository, viewer),
            number: issue.number,
          }),
        ),
      ),
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
        ...reviewers.flatMap(({ users }) => users.map((user) => user.username)),
      ],
      labels: issues.flatMap((issue) => issue.labels),
    });
    // Requests sharing a base branch share one in-flight lookup.
    const baseTip = new Map<string, Promise<string | null>>();
    return Promise.all(
      issues.map(async (issue, index) => {
        const row = rows.get(issue.id)!;
        if (!baseTip.has(row.baseRef))
          baseTip.set(
            row.baseRef,
            this.pulls.branchTip(row.baseRepositoryId, row.baseRef),
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
            baseSha: (await baseTip.get(row.baseRef)) ?? null,
            mergeCommitSha: row.mergeCommitSha,
            mergedAt: row.mergedAt,
            base,
            head: row.headRepositoryId
              ? (heads.get(row.headRepositoryId) ?? null)
              : null,
            reviewers: reviewers[index]!,
          },
          context,
          detail,
        );
      }),
    );
  }

  /** One pull request with the merge state and counts only GitHub's single-pull response carries. */
  private async detailed(
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
    const mergeable = !open
      ? null
      : conflicted
        ? false
        : pull.mergeBase !== null && pull.mergeBase !== pull.headSha
          ? true
          : null;
    const requirements = mergeable
      ? await this.pulls.mergeRequirements({
          ...this.github.ref(repository, viewer),
          number,
        })
      : null;
    const [rest] = await this.rest(repository, viewer, [issue], {
      mergeable,
      conflicted,
      held:
        requirements &&
        mergeStateOf(
          [...requirements.violations, ...requirements.bypassed],
          pull.checks?.state ?? null,
        ),
      commits: pull.commitCount,
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changedFiles,
      reviewComments: await this.reviewCommentCount(pull.id),
    });
    return rest!;
  }

  /** The accounts behind commit emails, as GitHub's simple-user, keyed by lowercased email. */
  private async commitUsers(emails: string[]) {
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

  private async reviewCommentCount(pullRequestId: string) {
    const [row] = await this.db
      .select({ total: count() })
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
          eq(schema.pullRequestReviewComment.pullRequestId, pullRequestId),
          visibleReview(),
        ),
      );
    return row?.total ?? 0;
  }
}
