import {
  createUnionType,
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';

import type { PullRequestsService } from '../../../resources/pull-requests/pull-requests.service.js';
import { Connection } from '../connection.js';
import {
  CommentAuthorAssociation,
  DiffSide,
  PatchStatus,
  PullRequestReviewState,
  PullRequestState,
} from '../enums.js';
import { GitObjectID, URI } from '../scalars.js';
import { IssueOrPullRequestFields } from './issue-or-pull-request.type.js';
import {
  Assignable,
  Labelable,
  Node,
  UniformResourceLocatable,
} from './node.interface.js';
import {
  BotNode,
  StatusCheckRollupNode,
  TeamNode,
} from './placeholders.type.js';
import { UserNode } from './user.type.js';

@ObjectType('PullRequest', {
  implements: () => [Node, UniformResourceLocatable, Labelable, Assignable],
})
export class PullRequestNode extends IssueOrPullRequestFields {
  kind = 'PullRequest' as const;
  /** The pull_request row's id, which reviews hang off; the node id is the issue's, as for an issue. */
  pullRequestGhostId: string;
  baseRepositoryGhostId: string;
  headRepositoryGhostId: string | null;
  /** The stored head; the live one is PullRequestResolver.headRefOid. */
  storedHeadSha: string;
  mergeCommitSha: string | null;
  mergedByLogin: string | null;
  /** PullRequestsService.getPullRequest, started by the first field that needs git, so the fields sharing it read the repository once. */
  detail?: ReturnType<PullRequestsService['getPullRequest']>;
  requirements?: ReturnType<PullRequestsService['mergeRequirements']>;

  @Field(() => PullRequestState)
  state: PullRequestState;

  @Field()
  isDraft: boolean;

  @Field()
  merged: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  mergedAt: Date | null;

  @Field()
  baseRefName: string;

  @Field()
  headRefName: string;

  @Field()
  isCrossRepository: boolean;

  @Field()
  maintainerCanModify: boolean;
}

@ObjectType('GitActor')
export class GitActorNode {
  @Field(() => String, { nullable: true })
  email: string | null;

  @Field(() => String, { nullable: true })
  name: string | null;
}

export const GitActorConnection = Connection(GitActorNode, 'GitActor');

@ObjectType('Commit', { implements: () => [Node, UniformResourceLocatable] })
export class CommitNode {
  kind = 'Commit';

  @Field(() => GitActorNode, { nullable: true })
  author: GitActorNode | null;

  @Field(() => GitActorNode, { nullable: true })
  committer: GitActorNode | null;

  @Field(() => ID)
  id: string;

  @Field(() => GitObjectID)
  oid: string;

  @Field()
  abbreviatedOid: string;

  @Field()
  message: string;

  @Field()
  messageHeadline: string;

  @Field()
  messageBody: string;

  @Field(() => GraphQLISODateTime)
  authoredDate: Date;

  @Field(() => GraphQLISODateTime)
  committedDate: Date;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;

  /** Only commits listed on a pull request carry their statuses; the rest have no rollup. */
  statusCheckRollup: StatusCheckRollupNode | null;
}

@ObjectType('PullRequestCommit', {
  implements: () => [Node, UniformResourceLocatable],
})
export class PullRequestCommitNode {
  @Field(() => ID)
  id: string;

  @Field(() => CommitNode)
  commit: CommitNode;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}

export const PullRequestCommitConnection = Connection(
  PullRequestCommitNode,
  'PullRequestCommit',
);

@ObjectType('PullRequestChangedFile')
export class PullRequestChangedFileNode {
  @Field()
  path: string;

  @Field(() => Int)
  additions: number;

  @Field(() => Int)
  deletions: number;

  @Field(() => PatchStatus)
  changeType: PatchStatus;
}

export const PullRequestChangedFileConnection = Connection(
  PullRequestChangedFileNode,
  'PullRequestChangedFile',
);

@ObjectType('PullRequestReview', { implements: () => [Node] })
export class PullRequestReviewNode {
  kind = 'PullRequestReview';
  ghostId: string;
  authorLogin: string;
  commitSha: string;
  /** The request it reviews, for reading the reviewed commit. */
  pullRequest: Pick<
    PullRequestNode,
    | 'ownerLogin'
    | 'repoSlug'
    | 'number'
    | 'repositoryGhostId'
    | 'repositoryUrl'
    | 'repositoryResourcePath'
  >;

  @Field(() => ID)
  id: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;

  @Field()
  body: string;

  @Field(() => PullRequestReviewState)
  state: PullRequestReviewState;

  @Field(() => CommentAuthorAssociation)
  authorAssociation: CommentAuthorAssociation;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  submittedAt: Date | null;

  @Field()
  includesCreatedEdit: boolean;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}

export const PullRequestReviewConnection = Connection(
  PullRequestReviewNode,
  'PullRequestReview',
);

export const RequestedReviewer = createUnionType({
  name: 'RequestedReviewer',
  types: () => [UserNode, TeamNode, BotNode] as const,
  resolveType: (value: { kind: string }) => value.kind,
});

@ObjectType('ReviewRequest', { implements: () => [Node] })
export class ReviewRequestNode {
  @Field(() => ID)
  id: string;

  @Field()
  asCodeOwner: boolean;

  @Field(() => RequestedReviewer, { nullable: true })
  requestedReviewer: UserNode | TeamNode | BotNode | null;
}

export const ReviewRequestConnection = Connection(
  ReviewRequestNode,
  'ReviewRequest',
);

export const TeamConnection = Connection(TeamNode, 'Team');

export const PullRequestConnection = Connection(
  PullRequestNode,
  'PullRequest',
  { edges: true },
);

@ObjectType('PullRequestReviewComment', { implements: () => [Node] })
export class PullRequestReviewCommentNode {
  kind = 'PullRequestReviewComment';
  authorLogin: string;

  @Field(() => ID)
  id: string;

  @Field()
  body: string;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;
}

export const PullRequestReviewCommentConnection = Connection(
  PullRequestReviewCommentNode,
  'PullRequestReviewComment',
);

/** A thread is its first comment and the replies under it; the id names the pull request's issue too, so a mutation can find the request without another lookup. */
@ObjectType('PullRequestReviewThread', { implements: () => [Node] })
export class PullRequestReviewThreadNode {
  kind = 'PullRequestReviewThread';
  resolvedById: string | null;
  /** The first comment, then its replies, oldest first. */
  threadComments: PullRequestReviewCommentNode[];

  @Field(() => ID)
  id: string;

  @Field()
  isResolved: boolean;

  /** GitHub collapses exactly the resolved threads. */
  @Field()
  isCollapsed: boolean;

  /** Made on a commit that is no longer the head. */
  @Field()
  isOutdated: boolean;

  @Field()
  path: string;

  @Field(() => Int, { nullable: true })
  line: number | null;

  @Field(() => Int, { nullable: true })
  startLine: number | null;

  @Field(() => DiffSide)
  diffSide: DiffSide;

  @Field()
  viewerCanResolve: boolean;

  @Field()
  viewerCanUnresolve: boolean;
}

export const PullRequestReviewThreadConnection = Connection(
  PullRequestReviewThreadNode,
  'PullRequestReviewThread',
);
