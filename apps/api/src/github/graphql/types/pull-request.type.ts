import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { PullRequestState } from '../enums.js';
import { URI } from '../scalars.js';
import { Node, UniformResourceLocatable } from './node.interface.js';

/** Identity only, so issueOrPullRequest can answer a pull request's number; the full type arrives with milestone 3. */
@ObjectType('PullRequest', { implements: () => [Node, UniformResourceLocatable] })
export class PullRequestNode {
  kind = 'PullRequest';

  @Field(() => ID)
  id: string;

  @Field(() => Int)
  number: number;

  @Field()
  title: string;

  @Field(() => PullRequestState)
  state: PullRequestState;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}
