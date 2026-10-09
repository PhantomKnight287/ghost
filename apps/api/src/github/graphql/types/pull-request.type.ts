import { Field, ObjectType } from '@nestjs/graphql';

import { PullRequestState } from '../enums.js';
import { IssueOrPullRequestFields } from './issue-or-pull-request.type.js';
import {
  Assignable,
  Labelable,
  Node,
  UniformResourceLocatable,
} from './node.interface.js';

/** The fields a pull request shares with an issue, so gh's issue commands can read a pull request's number; the rest arrives with milestone 3. */
@ObjectType('PullRequest', {
  implements: () => [Node, UniformResourceLocatable, Labelable, Assignable],
})
export class PullRequestNode extends IssueOrPullRequestFields {
  kind = 'PullRequest' as const;

  @Field(() => PullRequestState)
  state: PullRequestState;
}
