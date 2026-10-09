import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import { ReactionContent } from '../enums.js';

/** Ghost has no milestones, reactions or sub-issues. These types exist so gh's fixed queries validate; resolvers answer them empty. */

@ObjectType('Milestone')
export class MilestoneNode {
  @Field(() => ID)
  id: string;

  @Field(() => Int)
  number: number;

  @Field()
  title: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  dueOn: Date | null;
}

@ObjectType('ReactingUserConnection')
export class ReactingUserConnection {
  @Field(() => Int)
  totalCount: number;
}

@ObjectType('ReactionGroup')
export class ReactionGroup {
  @Field(() => ReactionContent)
  content: ReactionContent;

  @Field(() => ReactingUserConnection)
  users: ReactingUserConnection;
}

@ObjectType('SubIssuesSummary')
export class SubIssuesSummary {
  @Field(() => Int)
  total: number;

  @Field(() => Int)
  completed: number;

  @Field(() => Int)
  percentCompleted: number;
}
