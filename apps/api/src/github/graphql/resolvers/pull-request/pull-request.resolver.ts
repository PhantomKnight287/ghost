import {
  Args,
  Context,
  ID,
  Int,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { toRefNode } from '../../../../lib/github/nodes.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { sliceConnection } from '../../connection.js';
import {
  MergeableState,
  MergeStateStatus,
  PullRequestReviewDecision,
} from '../../enums.js';
import { BigIntString, GitObjectID } from '../../scalars.js';
import { IssueConnection } from '../../types/issue.type.js';
import { IssueCommentConnection } from '../../types/issue-comment.type.js';
import { LabelConnection } from '../../types/label.type.js';
import { Actor, RepositoryOwner } from '../../types/node.interface.js';
import {
  AutoMergeRequestNode,
  CheckRunNode,
  MilestoneNode,
  ProjectV2ItemConnection,
  ReactionGroup,
  StatusCheckRollupContextConnection,
  StatusCheckRollupNode,
  StatusContextNode,
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
  TeamConnection,
} from '../../types/pull-request.type.js';
import { RefNode, RepositoryNode } from '../../types/repository.type.js';
import { UserConnection, UserNode } from '../../types/user.type.js';
import { IssueNodesService } from '../issue/issue-nodes.service.js';
import { RepositoryNodesService } from '../repository/repository-nodes.service.js';
import { PullRequestNodesService } from './pull-request-nodes.service.js';

/** The fields a pull request shares with an issue answer exactly as the issue's do; the rest read the pull_request row, its reviews, or git. */
@Resolver(() => PullRequestNode)
@AllowAnonymous()
export class PullRequestResolver {
  constructor(
    private readonly pulls: PullRequestNodesService,
    private readonly issues: IssueNodesService,
    private readonly repositories: RepositoryNodesService,
  ) {}

  @ResolveField(() => Int, { nullable: true })
  databaseId(
    @Parent() pull: PullRequestNode,
    @Context() context: GraphqlContext,
  ) {
    return this.issues.databaseId(pull, context.loaders);
  }

  @ResolveField(() => BigIntString, { nullable: true })
  fullDatabaseId(
    @Parent() pull: PullRequestNode,
    @Context() context: GraphqlContext,
  ) {
    return this.issues.databaseId(pull, context.loaders);
  }

  @ResolveField(() => Actor, { nullable: true })
  author(@Parent() pull: PullRequestNode, @Context() context: GraphqlContext) {
    return this.issues.author(pull, context.loaders);
  }

  @ResolveField(() => Actor, { nullable: true })
  mergedBy(
    @Parent() pull: PullRequestNode,
    @Context() context: GraphqlContext,
  ) {
    return (
      pull.mergedByLogin &&
      this.issues.author({ authorLogin: pull.mergedByLogin }, context.loaders)
    );
  }

  @ResolveField(() => UserConnection)
  assignees(
    @Parent() pull: PullRequestNode,
    @Context() context: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ) {
    return this.issues.assignees(pull, context.loaders, first);
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
    return this.issues.comments(
      pull,
      viewer,
      context.loaders,
      first,
      last,
      after,
    );
  }

  @ResolveField(() => RepositoryNode)
  repository(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.load(pull.repositoryGhostId, viewer);
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
    return sliceConnection([], {});
  }

  @ResolveField(() => RefNode, { nullable: true })
  baseRef(@Parent() pull: PullRequestNode) {
    return toRefNode(pull.baseRepositoryGhostId, pull.baseRefName);
  }

  @ResolveField(() => RefNode, { nullable: true })
  headRef(@Parent() pull: PullRequestNode) {
    return this.pulls.headRef(pull);
  }

  @ResolveField(() => GitObjectID)
  headRefOid(@Parent() pull: PullRequestNode) {
    return this.pulls.headRefOid(pull);
  }

  @ResolveField(() => GitObjectID)
  baseRefOid(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.baseRefOid(pull, viewer);
  }

  @ResolveField(() => CommitNode, { nullable: true })
  mergeCommit(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.mergeCommit(pull, viewer);
  }

  @ResolveField(() => CommitNode, { nullable: true })
  potentialMergeCommit(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.potentialMergeCommit(pull, viewer);
  }

  @ResolveField(() => IssueConnection, { nullable: true })
  closingIssuesReferences(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.pulls.closingIssuesReferences(pull, viewer, first, after);
  }

  @ResolveField(() => RepositoryNode)
  baseRepository(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.baseRepository(pull, viewer);
  }

  @ResolveField(() => RepositoryNode, { nullable: true })
  headRepository(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.headRepository(pull, viewer);
  }

  @ResolveField(() => RepositoryOwner, { nullable: true })
  headRepositoryOwner(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.pulls.headRepositoryOwner(pull, viewer, context.loaders);
  }

  @ResolveField(() => Int)
  additions(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.additions(pull, viewer);
  }

  @ResolveField(() => Int)
  deletions(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.deletions(pull, viewer);
  }

  @ResolveField(() => Int)
  changedFiles(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.changedFiles(pull, viewer);
  }

  @ResolveField(() => MergeableState)
  mergeable(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.mergeable(pull, viewer);
  }

  @ResolveField(() => MergeStateStatus)
  mergeStateStatus(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.mergeStateStatus(pull, viewer);
  }

  @ResolveField(() => PullRequestReviewDecision, { nullable: true })
  reviewDecision(
    @Parent() pull: PullRequestNode,
    @Context() context: GraphqlContext,
  ) {
    return this.pulls.reviewDecision(pull, context.loaders);
  }

  @ResolveField(() => PullRequestReviewConnection, { nullable: true })
  reviews(
    @Parent() pull: PullRequestNode,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.pulls.reviews(pull, loaders, first, last, after);
  }

  @ResolveField(() => PullRequestReviewConnection, { nullable: true })
  latestReviews(
    @Parent() pull: PullRequestNode,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.pulls.latestReviews(pull, loaders, first, last, after);
  }

  @ResolveField(() => ReviewRequestConnection, { nullable: true })
  reviewRequests(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.pulls.reviewRequests(pull, viewer, loaders, first, after);
  }

  @ResolveField(() => AutoMergeRequestNode, { nullable: true })
  autoMergeRequest() {
    return null;
  }

  @ResolveField(() => PullRequestChangedFileConnection, { nullable: true })
  files(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.pulls.files(pull, viewer, first, after);
  }

  @ResolveField(() => PullRequestCommitConnection)
  commits(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.pulls.commits(pull, viewer, first, last, after);
  }
}

/** Commit.authors takes GitHub's paging arguments; statusCheckRollup is null for a commit without statuses. */
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
  statusCheckRollup(@Parent() commit: CommitNode) {
    return commit.statusCheckRollup;
  }
}

/** The account behind a commit's author or committer email, as GitHub links them. */
@Resolver(() => GitActorNode)
@AllowAnonymous()
export class GitActorResolver {
  constructor(private readonly pulls: PullRequestNodesService) {}

  @ResolveField(() => UserNode, { nullable: true })
  user(@Parent() actor: GitActorNode, @Context() { loaders }: GraphqlContext) {
    return this.pulls.actorUser(actor, loaders);
  }
}

@Resolver(() => StatusCheckRollupNode)
@AllowAnonymous()
export class StatusCheckRollupResolver {
  @ResolveField(() => StatusCheckRollupContextConnection)
  contexts(
    @Parent() rollup: StatusCheckRollupNode,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return sliceConnection(rollup.contexts, { first, after });
  }
}

/** Ghost has no branch protection, so no status or check is ever required to merge. */
@Resolver(() => StatusContextNode)
@AllowAnonymous()
export class StatusContextResolver {
  @ResolveField(() => Boolean)
  isRequired(
    @Args('pullRequestId', { type: () => ID, nullable: true })
    _pullRequestId?: string,
    @Args('pullRequestNumber', { type: () => Int, nullable: true })
    _pullRequestNumber?: number,
  ) {
    return false;
  }
}

/** Ghost has no check runs; this exists only so gh's checks query validates. */
@Resolver(() => CheckRunNode)
@AllowAnonymous()
export class CheckRunResolver {
  @ResolveField(() => Boolean)
  isRequired(
    @Args('pullRequestId', { type: () => ID, nullable: true })
    _pullRequestId?: string,
    @Args('pullRequestNumber', { type: () => Int, nullable: true })
    _pullRequestNumber?: number,
  ) {
    return false;
  }
}

@Resolver(() => PullRequestReviewNode)
@AllowAnonymous()
export class PullRequestReviewResolver {
  constructor(
    private readonly pulls: PullRequestNodesService,
    private readonly issues: IssueNodesService,
  ) {}

  @ResolveField(() => CommitNode, { nullable: true })
  commit(
    @Parent() review: PullRequestReviewNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.reviewCommit(review, viewer);
  }

  @ResolveField(() => Actor, { nullable: true })
  author(
    @Parent() review: PullRequestReviewNode,
    @Context() { loaders }: GraphqlContext,
  ) {
    return this.issues.author(review, loaders);
  }

  @ResolveField(() => TeamConnection)
  onBehalfOf(
    @Parent() review: PullRequestReviewNode,
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.pulls.onBehalfOf(review, viewer, loaders, first, after);
  }

  @ResolveField(() => [ReactionGroup], { nullable: true })
  reactionGroups() {
    return [];
  }
}
