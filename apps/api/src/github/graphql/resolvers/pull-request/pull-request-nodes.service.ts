import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, isNotNull, or, sql } from 'drizzle-orm';

import { DATABASE } from '../../../../database/database.module.js';
import { orNull } from '../../../../lib/github/authorize.js';
import type { Loaders } from '../../../../lib/github/loaders.js';
import { encodeNodeId } from '../../../../lib/github/node-id.js';
import { closingIssueIdsOf } from '../../../../lib/github/node-lookup.js';
import { resolveDefaultRef } from '../../../../lib/git/tree/resolve-ref.js';
import { mergeStateOf } from '../../../../lib/github/merge-state.js';
import { RepositoryMaterializerService } from '../../../../services/git/materializer/repository-materializer.service.js';
import { decodeNodeIdAs } from '../../../../lib/github/node-id.js';
import { requiredContexts } from '../../../../lib/rulesets/evaluate-rulesets.js';
import type { StatusContextNode } from '../../types/placeholders.type.js';
import {
  toCommitNode,
  toPullRequestReviewNode,
  toRefNode,
  toUserNode,
} from '../../../../lib/github/nodes.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import { canResolveThreads } from '../../../../lib/pull-requests/reviews.js';
import { teamSlug } from '../../../../lib/organizations/team-slug.js';
import { MERGE_METHODS } from '../../../../resources/pull-requests/dto/pull-request-changes.dto.js';
import { PullRequestsService } from '../../../../resources/pull-requests/pull-requests.service.js';
import { ReviewRequestsService } from '../../../../resources/pull-requests/review-requests.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { sliceConnection } from '../../connection.js';
import {
  DiffSide,
  MergeableState,
  MergeStateStatus,
  PatchStatus,
  PullRequestReviewDecision,
  PullRequestReviewState,
  PullRequestState,
} from '../../enums.js';
import { IssueNode } from '../../types/issue.type.js';
import type { OrganizationNode } from '../../types/organization.type.js';
import { TeamNode } from '../../types/placeholders.type.js';
import {
  GitActorNode,
  PullRequestNode,
  PullRequestReviewCommentNode,
  PullRequestReviewNode,
  PullRequestReviewThreadNode,
} from '../../types/pull-request.type.js';
import { RepositoryNodesService } from '../repository/repository-nodes.service.js';

// ponytail: a pull request's commits are read in one page of this many; gh asks for 100 at most.
const MAX_COMMITS = 250;

const CHANGE_TYPES: Record<string, PatchStatus> = {
  A: PatchStatus.ADDED,
  D: PatchStatus.DELETED,
  M: PatchStatus.MODIFIED,
  T: PatchStatus.CHANGED,
};

@Injectable()
export class PullRequestNodesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repositories: RepositoryNodesService,
    private readonly pulls: PullRequestsService,
    private readonly requested: ReviewRequestsService,
    private readonly config: ConfigService,
    private readonly materializer: RepositoryMaterializerService,
  ) {}

  /** getPullRequest once per node: additions, mergeable and the live head all come from the same git reads. */
  private detail(pull: PullRequestNode, viewer: GithubViewer | null) {
    pull.detail ??= this.pulls.getPullRequest(this.ref(pull, viewer));
    return pull.detail;
  }

  /** The merge requirements once per node, for the viewer; a repository without rulesets costs the loader's one query. */
  private requirements(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    pull.requirements ??= loaders.activeRulesetsByRepositoryId
      .load(pull.baseRepositoryGhostId)
      .then((rulesets) =>
        rulesets.length === 0
          ? {
              violations: [],
              bypassed: [],
              allowedMethods: [...MERGE_METHODS],
              reviewsRequired: false,
              requiredContexts: [],
            }
          : this.pulls.mergeRequirements({
              ...this.ref(pull, viewer),
              rulesets,
            }),
      );
    return pull.requirements;
  }

  headRef(pull: PullRequestNode) {
    return pull.headRepositoryGhostId
      ? toRefNode(pull.headRepositoryGhostId, pull.headRefName)
      : null;
  }

  /** The branch as it stands while the request is open; what was merged, or last recorded, once it is not. */
  async headRefOid(pull: PullRequestNode) {
    if (pull.state !== PullRequestState.OPEN) return pull.storedHeadSha;
    return (
      (await this.pulls.branchTip(
        pull.headRepositoryGhostId,
        pull.headRefName,
      )) ?? pull.storedHeadSha
    );
  }

  baseRepository(pull: PullRequestNode, viewer: GithubViewer | null) {
    return this.repositories.load(pull.baseRepositoryGhostId, viewer);
  }

  /** Null once the head repository is deleted, or when the viewer cannot read it, as on GitHub. */
  headRepository(pull: PullRequestNode, viewer: GithubViewer | null) {
    return pull.headRepositoryGhostId
      ? orNull(this.repositories.load(pull.headRepositoryGhostId, viewer))
      : null;
  }

  async headRepositoryOwner(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    const head = await this.headRepository(pull, viewer);
    return head ? this.repositories.owner(head, loaders) : null;
  }

  async additions(pull: PullRequestNode, viewer: GithubViewer | null) {
    return (await this.detail(pull, viewer)).additions;
  }

  async deletions(pull: PullRequestNode, viewer: GithubViewer | null) {
    return (await this.detail(pull, viewer)).deletions;
  }

  async changedFiles(pull: PullRequestNode, viewer: GithubViewer | null) {
    return (await this.detail(pull, viewer)).changedFiles;
  }

  /** GitHub answers UNKNOWN for anything not open, and for a head with nothing to merge. */
  async mergeable(pull: PullRequestNode, viewer: GithubViewer | null) {
    if (pull.state !== PullRequestState.OPEN) return MergeableState.UNKNOWN;
    const detail = await this.detail(pull, viewer);
    if (detail.conflicts.length > 0) return MergeableState.CONFLICTING;
    return detail.mergeBase && detail.mergeBase !== detail.headSha
      ? MergeableState.MERGEABLE
      : MergeableState.UNKNOWN;
  }

  /** Whether an active rule on the base of the pull request `pull` names requires `status`'s context. The pull request must be in the repository whose rollup holds the status. */
  async contextRequired(
    status: StatusContextNode,
    pull: { id?: string; number?: number },
    loaders: Loaders,
  ) {
    if (!pull.id && pull.number === undefined) return false;
    const [row] = await this.db
      .select({
        baseRepositoryId: schema.pullRequest.baseRepositoryId,
        baseRef: schema.pullRequest.baseRef,
        defaultBranch: schema.repository.defaultBranch,
      })
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.pullRequest.baseRepositoryId),
      )
      .where(
        and(
          // Only a pull request in the repository whose rollup holds the status: any other id could name one the viewer cannot read.
          eq(schema.issue.repositoryId, status.repositoryId),
          pull.id
            ? eq(schema.issue.id, decodeNodeIdAs(pull.id, 'PullRequest'))
            : eq(schema.issue.number, pull.number!),
        ),
      );
    if (!row) return false;
    const rulesets = await loaders.activeRulesetsByRepositoryId.load(
      row.baseRepositoryId,
    );
    if (rulesets.length === 0) return false;
    // The row names a default branch only when one was chosen; otherwise HEAD does, as for merges.
    const defaultBranch = (
      await resolveDefaultRef({
        gitDir: await this.materializer.open({
          id: row.baseRepositoryId,
          defaultBranch: row.defaultBranch,
        }),
        defaultBranch: row.defaultBranch,
      })
    ).replace(/^refs\/heads\//, '');
    return requiredContexts(
      rulesets,
      `refs/heads/${row.baseRef}`,
      defaultBranch,
    ).includes(status.context);
  }

  /** BLOCKED for a bypass actor too, as GitHub answers, which is why gh tells them to pass `--admin`. */
  async mergeStateStatus(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    if (pull.state === PullRequestState.OPEN && pull.isDraft)
      return MergeStateStatus.DRAFT;
    const mergeable = await this.mergeable(pull, viewer);
    if (mergeable === MergeableState.CONFLICTING) return MergeStateStatus.DIRTY;
    if (mergeable !== MergeableState.MERGEABLE) return MergeStateStatus.UNKNOWN;
    const [{ violations, bypassed }, detail] = await Promise.all([
      this.requirements(pull, viewer, loaders),
      this.detail(pull, viewer),
    ]);
    return mergeStateOf(
      [...violations, ...bypassed],
      detail.checks?.state ?? null,
    ).toUpperCase() as MergeStateStatus;
  }

  /** As GitHub answers: null unless a rule on the base asks for reviews, though a standing change request a rule blocks on shows either way. A closed or merged request, whose rules are no longer judged, falls back to each reviewer's standing verdict. */
  async reviewDecision(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    if (pull.state === PullRequestState.OPEN) {
      const { violations, bypassed, reviewsRequired } = await this.requirements(
        pull,
        viewer,
        loaders,
      );
      const unmet = new Set(
        [...violations, ...bypassed].map(({ requirement }) => requirement),
      );
      if (unmet.has('changes_requested'))
        return PullRequestReviewDecision.CHANGES_REQUESTED;
      if (unmet.has('approvals') || unmet.has('code_owners'))
        return PullRequestReviewDecision.REVIEW_REQUIRED;
      return reviewsRequired ? PullRequestReviewDecision.APPROVED : null;
    }
    const verdicts = (await this.latestReviews(pull, loaders)).nodes
      .map((review) => review.state)
      .filter(
        (state) =>
          state === PullRequestReviewState.APPROVED ||
          state === PullRequestReviewState.CHANGES_REQUESTED,
      );
    if (verdicts.includes(PullRequestReviewState.CHANGES_REQUESTED))
      return PullRequestReviewDecision.CHANGES_REQUESTED;
    if (verdicts.includes(PullRequestReviewState.APPROVED))
      return PullRequestReviewDecision.APPROVED;
    return null;
  }

  async reviews(
    pull: PullRequestNode,
    loaders: Loaders,
    first?: number,
    last?: number,
    after?: string,
  ) {
    const rows = await loaders.reviewsByPullRequestId.load(
      pull.pullRequestGhostId,
    );
    return sliceConnection(
      rows.map((row) => toPullRequestReviewNode(row, pull)),
      { first, last, after },
    );
  }

  /** Each reviewer's most recent verdict, or most recent comment when they gave none, in the order they were submitted. */
  async latestReviews(
    pull: PullRequestNode,
    loaders: Loaders,
    first?: number,
    last?: number,
    after?: string,
  ) {
    const rows = await loaders.reviewsByPullRequestId.load(
      pull.pullRequestGhostId,
    );
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const kept = latest.get(row.authorLogin);
      // A comment, a reply's own review among them, leaves the reviewer's standing verdict in place.
      if (!kept || row.state !== 'commented' || kept.state === 'commented')
        latest.set(row.authorLogin, row);
    }
    return sliceConnection(
      rows
        .filter((row) => latest.get(row.authorLogin) === row)
        .map((row) => toPullRequestReviewNode(row, pull)),
      { first, last, after },
    );
  }

  /** Submitted threads, oldest first, each with its comments; `commentId` picks the one that comment starts. */
  async reviewThreads(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    loaders: Loaders,
    commentId?: string,
  ) {
    const comment = schema.pullRequestReviewComment;
    const [rows, headSha, repository, viewerRow] = await Promise.all([
      this.db
        .select({
          id: comment.id,
          inReplyToId: comment.inReplyToId,
          authorLogin: sql<string>`coalesce(${schema.user.username}, '')`,
          body: comment.body,
          createdAt: comment.createdAt,
          path: comment.path,
          side: comment.side,
          line: comment.line,
          startLine: comment.startLine,
          commitSha: comment.commitSha,
          resolvedById: comment.resolvedById,
          resolvedAt: comment.resolvedAt,
        })
        .from(comment)
        .innerJoin(
          schema.pullRequestReview,
          eq(schema.pullRequestReview.id, comment.reviewId),
        )
        .innerJoin(schema.user, eq(schema.user.id, comment.authorId))
        .where(
          and(
            eq(comment.pullRequestId, pull.pullRequestGhostId),
            isNotNull(schema.pullRequestReview.submittedAt),
            commentId
              ? or(
                  eq(comment.id, commentId),
                  eq(comment.inReplyToId, commentId),
                )
              : undefined,
          ),
        )
        .orderBy(asc(comment.createdAt), asc(comment.id)),
      this.headRefOid(pull),
      this.repositories.load(pull.repositoryGhostId, viewer),
      viewer ? loaders.usersById.load(viewer.userId) : null,
    ]);
    const canResolve = canResolveThreads(
      repository.viewerRole,
      viewerRow?.username === pull.authorLogin,
    );
    return rows
      .filter((thread) => thread.inReplyToId === null)
      .map((thread) =>
        Object.assign(new PullRequestReviewThreadNode(), {
          id: encodeNodeId(
            'PullRequestReviewThread',
            `${pull.ghostId}:${thread.id}`,
          ),
          resolvedById: thread.resolvedById,
          isResolved: thread.resolvedAt !== null,
          isCollapsed: thread.resolvedAt !== null,
          isOutdated: thread.commitSha !== headSha,
          path: thread.path,
          line: thread.line,
          startLine: thread.startLine,
          diffSide:
            thread.side === 'additions' ? DiffSide.RIGHT : DiffSide.LEFT,
          viewerCanResolve: canResolve && thread.resolvedAt === null,
          viewerCanUnresolve: canResolve && thread.resolvedAt !== null,
          threadComments: rows
            .filter((row) => (row.inReplyToId ?? row.id) === thread.id)
            .map((row) =>
              Object.assign(new PullRequestReviewCommentNode(), {
                authorLogin: row.authorLogin,
                id: encodeNodeId('PullRequestReviewComment', row.id),
                body: row.body,
                createdAt: row.createdAt,
              }),
            ),
        }),
      );
  }

  async resolvedBy(thread: PullRequestReviewThreadNode, loaders: Loaders) {
    const row =
      thread.resolvedById &&
      (await loaders.usersById.load(thread.resolvedById));
    return row ? toUserNode(row, githubOrigins(this.config)) : null;
  }

  /** Pending requests, users before teams, each in the order they were asked. */
  async reviewRequests(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    loaders: Loaders,
    first?: number,
    after?: string,
  ) {
    const { users, teams } = await this.requested.list(this.ref(pull, viewer));
    const origins = githubOrigins(this.config);
    const reviewers = [
      ...(await Promise.all(
        users.map(async (user) =>
          toUserNode((await loaders.usersById.load(user.id))!, origins),
        ),
      )),
      ...(await this.teamNodes(teams, pull.repositoryGhostId, viewer, loaders)),
    ];
    return sliceConnection(
      [...users, ...teams].map((request, index) => ({
        id: encodeNodeId(
          'ReviewRequest',
          `${pull.pullRequestGhostId}:${request.id}`,
        ),
        asCodeOwner: request.asCodeOwner,
        requestedReviewer: reviewers[index]!,
      })),
      { first, after },
    );
  }

  /** The teams whose requests the review answered. */
  async onBehalfOf(
    review: PullRequestReviewNode,
    viewer: GithubViewer | null,
    loaders: Loaders,
    first?: number,
    after?: string,
  ) {
    const teams = await this.db
      .select({ id: schema.team.id, name: schema.team.name })
      .from(schema.pullRequestReviewOnBehalfOf)
      .innerJoin(
        schema.team,
        eq(schema.team.id, schema.pullRequestReviewOnBehalfOf.teamId),
      )
      .where(eq(schema.pullRequestReviewOnBehalfOf.reviewId, review.ghostId))
      .orderBy(asc(schema.team.name));
    return sliceConnection(
      await this.teamNodes(
        teams,
        review.pullRequest.repositoryGhostId,
        viewer,
        loaders,
      ),
      { first, after },
    );
  }

  async files(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    first?: number,
    after?: string,
  ) {
    const { files } = await this.pulls.getFiles(this.ref(pull, viewer));
    return sliceConnection(
      files.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
        changeType: CHANGE_TYPES[file.status] ?? PatchStatus.MODIFIED,
      })),
      { first, after },
    );
  }

  /** Oldest first, as GitHub lists them; gh reads the last one for the head's checks. */
  async commits(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    first?: number,
    last?: number,
    after?: string,
  ) {
    const { commits, total } = await this.pulls.getCommits({
      ...this.ref(pull, viewer),
      limit: MAX_COMMITS,
      oldestFirst: true,
    });
    const repository = {
      ghostId: pull.repositoryGhostId,
      url: pull.repositoryUrl,
      resourcePath: pull.repositoryResourcePath,
    };
    const nodes = commits.map((commit) => ({
      id: encodeNodeId('PullRequestCommit', `${pull.ghostId}:${commit.sha}`),
      url: `${pull.url}/commits/${commit.sha}`,
      resourcePath: `${pull.resourcePath}/commits/${commit.sha}`,
      commit: toCommitNode(commit, repository),
    }));
    return {
      ...sliceConnection(nodes, { first, last, after }),
      totalCount: total,
    };
  }

  /** The account behind a commit's author or committer email, as GitHub links them. */
  async actorUser(actor: GitActorNode, loaders: Loaders) {
    if (!actor.email) return null;
    const row = await loaders.usersByEmail.load(actor.email.toLowerCase());
    return row ? toUserNode(row, githubOrigins(this.config)) : null;
  }

  /** The head the reviewer read; null once no repository holds it. */
  reviewCommit(review: PullRequestReviewNode, viewer: GithubViewer | null) {
    return this.commit(review.pullRequest, review.commitSha, viewer);
  }

  mergeCommit(pull: PullRequestNode, viewer: GithubViewer | null) {
    return pull.mergeCommitSha
      ? this.commit(pull, pull.mergeCommitSha, viewer)
      : null;
  }

  async potentialMergeCommit(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
  ) {
    const sha = await this.pulls.testMergeSha(this.ref(pull, viewer));
    return sha && this.commit(pull, sha, viewer);
  }

  baseRefOid(pull: PullRequestNode, viewer: GithubViewer | null) {
    return this.pulls.baseSha(this.ref(pull, viewer));
  }

  /** Issues in other repositories the viewer cannot read are left out, as on GitHub. */
  async closingIssuesReferences(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    first?: number,
    after?: string,
  ) {
    const ids = await closingIssueIdsOf(this.db, pull.ghostId);
    const issues = await Promise.all(
      ids.map((id) => this.repositories.issueById(id, viewer)),
    );
    return sliceConnection(
      issues.filter((issue) => issue instanceof IssueNode),
      { first, after },
    );
  }

  private ref(
    pull: Pick<PullRequestNode, 'ownerLogin' | 'repoSlug' | 'number'>,
    viewer: GithubViewer | null,
  ) {
    return {
      username: pull.ownerLogin,
      repo: pull.repoSlug,
      number: pull.number,
      requesterId: viewer?.userId,
    };
  }

  /** Only teams of the organization owning the repository can be requested, so that organization is every team's. */
  private async teamNodes(
    teams: { id: string; name: string }[],
    repositoryGhostId: string,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    if (teams.length === 0) return [];
    const organization = (await this.repositories.owner(
      await this.repositories.load(repositoryGhostId, viewer),
      loaders,
    )) as OrganizationNode;
    return teams.map((team) =>
      Object.assign(new TeamNode(), {
        id: encodeNodeId('Team', team.id),
        name: team.name,
        slug: teamSlug(team.name),
        organization,
      }),
    );
  }

  /** A commit of the request from git; null once no repository holds it. */
  private async commit(
    pull: PullRequestReviewNode['pullRequest'],
    sha: string,
    viewer: GithubViewer | null,
  ) {
    const commit = await this.pulls.readCommit(this.ref(pull, viewer), sha);
    return (
      commit &&
      toCommitNode(commit, {
        ghostId: pull.repositoryGhostId,
        url: pull.repositoryUrl,
        resourcePath: pull.repositoryResourcePath,
      })
    );
  }
}
