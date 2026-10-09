import { createUnionType, Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import type { LabelDTO } from '../../../resources/issues/dto/label.dto.js';
import { Connection } from '../connection.js';
import { IssueState, IssueStateReason } from '../enums.js';
import { HTML, URI } from '../scalars.js';
import { Assignable, Labelable, Node, UniformResourceLocatable } from './node.interface.js';
import { PullRequestNode } from './pull-request.type.js';

@ObjectType('Issue', { implements: () => [Node, UniformResourceLocatable, Labelable, Assignable] })
export class IssueNode {
  kind = 'Issue';
  ghostId: string;
  ownerLogin: string;
  repoSlug: string;
  repositoryGhostId: string;
  authorLogin: string;
  assigneeLogins: string[];
  labelDtos: LabelDTO[];
  repositoryUrl: string;
  repositoryResourcePath: string;

  @Field(() => ID)
  id: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;

  @Field(() => Int)
  number: number;

  @Field()
  title: string;

  @Field()
  body: string;

  @Field(() => HTML)
  bodyHTML: string;

  @Field()
  bodyText: string;

  @Field(() => IssueState)
  state: IssueState;

  @Field(() => IssueStateReason, { nullable: true })
  stateReason: IssueStateReason | null;

  @Field()
  closed: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  closedAt: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt: Date;

  @Field()
  isPinned: boolean;

  @Field()
  locked: boolean;

  @Field()
  includesCreatedEdit: boolean;

  @Field()
  viewerCanUpdate: boolean;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}

export const IssueConnection = Connection(IssueNode, 'Issue');

export const IssueOrPullRequest = createUnionType({
  name: 'IssueOrPullRequest',
  types: () => [IssueNode, PullRequestNode] as const,
  resolveType: (value: { kind: string }) => value.kind,
});
