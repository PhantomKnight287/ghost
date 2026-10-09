import { createUnionType, Field, ObjectType } from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { IssueState, IssueStateReason } from '../enums.js';
import { IssueOrPullRequestFields } from './issue-or-pull-request.type.js';
import {
  Assignable,
  Labelable,
  Node,
  UniformResourceLocatable,
} from './node.interface.js';
import { PullRequestNode } from './pull-request.type.js';

@ObjectType('Issue', {
  implements: () => [Node, UniformResourceLocatable, Labelable, Assignable],
})
export class IssueNode extends IssueOrPullRequestFields {
  kind = 'Issue' as const;

  @Field(() => IssueState)
  state: IssueState;

  @Field(() => IssueStateReason, { nullable: true })
  stateReason: IssueStateReason | null;

  @Field()
  isPinned: boolean;
}

export const IssueConnection = Connection(IssueNode, 'Issue');

export const IssueOrPullRequest = createUnionType({
  name: 'IssueOrPullRequest',
  types: () => [IssueNode, PullRequestNode] as const,
  resolveType: (value: { kind: string }) => value.kind,
});
