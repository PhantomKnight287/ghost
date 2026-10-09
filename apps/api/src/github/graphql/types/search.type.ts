import { createUnionType, Field, Int, ObjectType } from '@nestjs/graphql';

import { PageInfo } from '../connection.js';
import { IssueNode } from './issue.type.js';
import { PullRequestNode } from './pull-request.type.js';

export const SearchResultItem = createUnionType({
  name: 'SearchResultItem',
  types: () => [IssueNode, PullRequestNode] as const,
  resolveType: (value: { kind: string }) => value.kind,
});

@ObjectType('SearchResultItemConnection')
export class SearchResultItemConnection {
  @Field(() => Int)
  issueCount: number;

  @Field(() => [SearchResultItem], { nullable: 'itemsAndList' })
  nodes: Array<IssueNode | PullRequestNode>;

  @Field(() => PageInfo)
  pageInfo: PageInfo;
}
