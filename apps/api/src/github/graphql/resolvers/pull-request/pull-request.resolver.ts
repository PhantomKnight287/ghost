import { ConfigService } from '@nestjs/config';
import {
  Args,
  Context,
  Int,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { orNull } from '../../../../lib/github/authorize.js';
import type { GraphqlContext } from '../../../../lib/github/loaders.js';
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
import { Viewer } from '../../../auth/viewer.decorator.js';
import { sliceConnection } from '../../connection.js';
import {
  MergeableState,
  MergeStateStatus,
  PatchStatus,
  PullRequestReviewDecision,
  PullRequestReviewState,
  PullRequestState,
} from '../../enums.js';
import { GitObjectID } from '../../scalars.js';
import { IssueCommentConnection } from '../../types/issue-comment.type.js';
import { LabelConnection } from '../../types/label.type.js';
import { Actor, RepositoryOwner } from '../../types/node.interface.js';
import {
  AutoMergeRequestNode,
  MilestoneNode,
  ProjectV2ItemConnection,
  ReactionGroup,
  StatusCheckRollupContextConnection,
  StatusCheckRollupNode,
} from '../../types/placeholders.type.js';
import {
  CommitNode,
  GitActorConnection,
  GitActorNode,
  PullRequestChangedFileConnection,
  PullRequestCommitConnection,
  PullRequestNode,
  PullRequestReviewConnection,
  PullRequestReviewNode,
  ReviewRequestConnection,
} from '../../types/pull-request.type.js';
import { RefNode, RepositoryNode } from '../../types/repository.type.js';
import { UserConnection, UserNode } from '../../types/user.type.js';
import { IssueResolver } from '../issue/issue.resolver.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';

// ponytail: a pull request's commits are read in one page of this many; gh asks for 100 at most.
const MAX_COMMITS = 250;

const CHANGE_TYPES: Record<string, PatchStatus> = {
  A: PatchStatus.ADDED,
  D: PatchStatus.DELETED,
  M: PatchStatus.MODIFIED,
  T: PatchStatus.CHANGED,
};

/** The fields a pull request shares with an issue answer exactly as the issue's do; the rest read the pull_request row, its reviews, or git. */
@Resolver(() => PullRequestNode)
@AllowAnonymous()
export class PullRequestResolver {
  constructor(
    private readonly issues: IssueResolver,
    private readonly repositories: RepositoryResolver,
    private readonly pulls: PullRequestsService,
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

  @ResolveField(() => Int, { nullable: true })
  databaseId(
    @Parent() pull: PullRequestNode,
    @Context() context: GraphqlContext,
  ) {
    return this.issues.databaseId(pull, context);
  }

  @ResolveField(() => Actor, { nullable: true })
  author(@Parent() pull: PullRequestNode, @Context() context: GraphqlContext) {
    return this.issues.author(pull, context);
  }

  @ResolveField(() => UserConnection)
  assignees(
    @Parent() pull: PullRequestNode,
    @Context() context: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ) {
    return this.issues.assignees(pull, context, first);
  }

  @ResolveField(() => LabelConnection, { nullable: true })
  labels(
    @Parent() pull: PullRequestNode,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ) {
    return this.issues.labels(pull, first);
  }

  @ResolveField(() => IssueCommentConnection)
  comments(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.issues.comments(pull, viewer, context, first, last, after);
  }

  @ResolveField(() => RepositoryNode)
  repository(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.repository(pull, viewer);
  }

  @ResolveField(() => MilestoneNode, { nullable: true })
  milestone() {
    return null;
  }

  @ResolveField(() => [ReactionGroup], { nullable: true })
  reactionGroups() {
    return [];
  }

  @ResolveField(() => ProjectV2ItemConnection)
  projectItems(
    @Args('first', { type: () => Int, nullable: true }) _first?: number,
    @Args('after', { type: () => String, nullable: true }) _after?: string,
    @Args('last', { type: () => Int, nullable: true }) _last?: number,
    @Args('before', { type: () => String, nullable: true }) _before?: string,
    @Args('includeArchived', {
      type: () => Boolean,
      nullable: true,
      defaultValue: true,
    })
    _includeArchived?: boolean,
  ) {
    return this.issues.projectItems();
  }

  @ResolveField(() => RefNode, { nullable: true })
  baseRef(@Parent() pull: PullRequestNode) {
    return toRefNode(pull.baseRepositoryGhostId, pull.baseRefName);
  }

  @ResolveField(() => RefNode, { nullable: true })
  headRef(@Parent() pull: PullRequestNode) {
    return pull.headRepositoryGhostId
      ? toRefNode(pull.headRepositoryGhostId, pull.headRefName)
      : null;
  }

  /** The branch as it stands while the request is open; what was merged, or last recorded, once it is not. */
  @ResolveField(() => GitObjectID)
  async headRefOid(@Parent() pull: PullRequestNode) {
    if (pull.state !== PullRequestState.OPEN) return pull.storedHeadSha;
    return (
      (await this.pulls.branchTip(
        pull.headRepositoryGhostId,
        pull.headRefName,
      )) ?? pull.storedHeadSha
    );
  }

  @ResolveField(() => RepositoryNode)
  baseRepository(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.load(pull.baseRepositoryGhostId, viewer);
  }

  /** Null once the head repository is deleted, or when the viewer cannot read it, as on GitHub. */
  @ResolveField(() => RepositoryNode, { nullable: true })
  headRepository(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return pull.headRepositoryGhostId
      ? orNull(this.repositories.load(pull.headRepositoryGhostId, viewer))
      : null;
  }

  @ResolveField(() => RepositoryOwner, { nullable: true })
  async headRepositoryOwner(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    const head = await this.headRepository(pull, viewer);
    return head ? this.repositories.owner(head, context) : null;
  }

  @ResolveField(() => Int)
  async additions(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return (await this.detail(pull, viewer)).additions;
  }

  @ResolveField(() => Int)
  async deletions(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return (await this.detail(pull, viewer)).deletions;
  }

  @ResolveField(() => Int)
  async changedFiles(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return (await this.detail(pull, viewer)).changedFiles;
  }

  /** GitHub answers UNKNOWN for anything not open, and for a head with nothing to merge. */
  @ResolveField(() => MergeableState)
  async mergeable(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    if (pull.state !== PullRequestState.OPEN) return MergeableState.UNKNOWN;
    const detail = await this.detail(pull, viewer);
    if (detail.conflicts.length > 0) return MergeableState.CONFLICTING;
    return detail.mergeBase && detail.mergeBase !== detail.headSha
      ? MergeableState.MERGEABLE
      : MergeableState.UNKNOWN;
  }

  @ResolveField(() => MergeStateStatus)
  async mergeStateStatus(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
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
  @ResolveField(() => PullRequestReviewDecision, { nullable: true })
  async reviewDecision(
    @Parent() pull: PullRequestNode,
    @Context() context: GraphqlContext,
  ) {
    const verdicts = (await this.latestReviews(pull, context)).nodes
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

  @ResolveField(() => PullRequestReviewConnection, { nullable: true })
  async reviews(
    @Parent() pull: PullRequestNode,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
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
  @ResolveField(() => PullRequestReviewConnection, { nullable: true })
  async latestReviews(
    @Parent() pull: PullRequestNode,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
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

  @ResolveField(() => ReviewRequestConnection, { nullable: true })
  reviewRequests(
    @Args('first', { type: () => Int, nullable: true }) _first?: number,
  ) {
    return sliceConnection([], {});
  }

  @ResolveField(() => AutoMergeRequestNode, { nullable: true })
  autoMergeRequest() {
    return null;
  }

  @ResolveField(() => PullRequestChangedFileConnection, { nullable: true })
  async files(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
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
  @ResolveField(() => PullRequestCommitConnection)
  async commits(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
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
}

/** Commit.authors takes GitHub's paging arguments; statusCheckRollup is null until Ghost records commit statuses (#61). */
@Resolver(() => CommitNode)
@AllowAnonymous()
export class CommitResolver {
  @ResolveField(() => GitActorConnection)
  authors(
    @Parent() commit: CommitNode,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ) {
    return sliceConnection(commit.author ? [commit.author] : [], { first });
  }

  @ResolveField(() => StatusCheckRollupNode, { nullable: true })
  statusCheckRollup() {
    return null;
  }
}

/** The account behind a commit's author or committer email, as GitHub links them. */
@Resolver(() => GitActorNode)
@AllowAnonymous()
export class GitActorResolver {
  constructor(private readonly config: ConfigService) {}

  @ResolveField(() => UserNode, { nullable: true })
  async user(
    @Parent() actor: GitActorNode,
    @Context() { loaders }: GraphqlContext,
  ) {
    if (!actor.email) return null;
    const row = await loaders.usersByEmail.load(actor.email.toLowerCase());
    return row ? toUserNode(row, githubOrigins(this.config)) : null;
  }
}

@Resolver(() => StatusCheckRollupNode)
@AllowAnonymous()
export class StatusCheckRollupResolver {
  @ResolveField(() => StatusCheckRollupContextConnection)
  contexts(
    @Args('first', { type: () => Int, nullable: true }) _first?: number,
    @Args('after', { type: () => String, nullable: true }) _after?: string,
  ) {
    return sliceConnection([], {});
  }
}

@Resolver(() => PullRequestReviewNode)
@AllowAnonymous()
export class PullRequestReviewResolver {
  constructor(
    private readonly config: ConfigService,
    private readonly pulls: PullRequestsService,
  ) {}

  /** The head the reviewer read, from git; null once no repository holds it. */
  @ResolveField(() => CommitNode, { nullable: true })
  async commit(
    @Parent() review: PullRequestReviewNode,
    @Viewer() viewer: GithubViewer | null,
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

  @ResolveField(() => Actor, { nullable: true })
  async author(
    @Parent() review: PullRequestReviewNode,
    @Context() { loaders }: GraphqlContext,
  ) {
    const row = await loaders.usersByLogin.load(review.authorLogin);
    return row ? toUserNode(row, githubOrigins(this.config)) : null;
  }

  @ResolveField(() => [ReactionGroup], { nullable: true })
  reactionGroups() {
    return [];
  }
}
