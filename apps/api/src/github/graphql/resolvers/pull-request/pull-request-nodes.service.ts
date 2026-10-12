import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { orNull } from '../../../../lib/github/authorize.js';
import type { Loaders } from '../../../../lib/github/loaders.js';
import { encodeNodeId } from '../../../../lib/github/node-id.js';
import {
  toCommitNode,
  toPullRequestReviewNode,
  toRefNode,
  toUserNode,
} from '../../../../lib/github/nodes.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import { PullRequestsService } from '../../../../resources/pull-requests/pull-requests.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { sliceConnection } from '../../connection.js';
import {
  MergeableState,
  MergeStateStatus,
  PatchStatus,
  PullRequestReviewDecision,
  PullRequestReviewState,
  PullRequestState,
} from '../../enums.js';
import {
  GitActorNode,
  PullRequestNode,
  PullRequestReviewNode,
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
    private readonly repositories: RepositoryNodesService,
    private readonly pulls: PullRequestsService,
    private readonly config: ConfigService,
  ) {}

  /** getPullRequest once per node: additions, mergeable and the live head all come from the same git reads. */
  private detail(pull: PullRequestNode, viewer: GithubViewer | null) {
    pull.detail ??= this.pulls.getPullRequest({
      username: pull.ownerLogin,
      repo: pull.repoSlug,
      number: pull.number,
      requesterId: viewer?.userId,
    });
    return pull.detail;
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

  async mergeStateStatus(pull: PullRequestNode, viewer: GithubViewer | null) {
    if (pull.state === PullRequestState.OPEN && pull.isDraft)
      return MergeStateStatus.DRAFT;
    const mergeable = await this.mergeable(pull, viewer);
    return mergeable === MergeableState.MERGEABLE
      ? MergeStateStatus.CLEAN
      : mergeable === MergeableState.CONFLICTING
        ? MergeStateStatus.DIRTY
        : MergeStateStatus.UNKNOWN;
  }

  /** Ghost never requires a review, so there is no REVIEW_REQUIRED: a request with no standing verdict has no decision. */
  async reviewDecision(pull: PullRequestNode, loaders: Loaders) {
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

  /** Each reviewer's most recent review, in the order they were submitted. */
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
    const latest = new Map(rows.map((row) => [row.authorLogin, row]));
    return sliceConnection(
      rows
        .filter((row) => latest.get(row.authorLogin) === row)
        .map((row) => toPullRequestReviewNode(row, pull)),
      { first, last, after },
    );
  }

  async files(
    pull: PullRequestNode,
    viewer: GithubViewer | null,
    first?: number,
    after?: string,
  ) {
    const { files } = await this.pulls.getFiles({
      username: pull.ownerLogin,
      repo: pull.repoSlug,
      number: pull.number,
      requesterId: viewer?.userId,
    });
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
      username: pull.ownerLogin,
      repo: pull.repoSlug,
      number: pull.number,
      requesterId: viewer?.userId,
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

  /** The head the reviewer read, from git; null once no repository holds it. */
  async reviewCommit(
    review: PullRequestReviewNode,
    viewer: GithubViewer | null,
  ) {
    const { pullRequest: pull } = review;
    const commit = await this.pulls.readCommit(
      {
        username: pull.ownerLogin,
        repo: pull.repoSlug,
        number: pull.number,
        requesterId: viewer?.userId,
      },
      review.commitSha,
    );
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
