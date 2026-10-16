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
import { BotNode, TeamNode } from './placeholders.type.js';
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

/** Ghost has no review requests; the connection is always empty. */
@ObjectType('ReviewRequest', { implements: () => [Node] })
export class ReviewRequestNode {
  @Field(() => ID)
  id: string;

  @Field(() => RequestedReviewer, { nullable: true })
  requestedReviewer: UserNode | TeamNode | BotNode | null;
}

export const ReviewRequestConnection = Connection(
  ReviewRequestNode,
  'ReviewRequest',
);

export const PullRequestConnection = Connection(
  PullRequestNode,
  'PullRequest',
  { edges: true },
);
