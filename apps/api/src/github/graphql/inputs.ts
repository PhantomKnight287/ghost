import { Field, InputType } from '@nestjs/graphql';

import { IssueOrderField, IssueState, OrderDirection } from './enums.js';

@InputType('IssueOrder')
export class IssueOrder {
  @Field(() => IssueOrderField)
  field: IssueOrderField;

  @Field(() => OrderDirection)
  direction: OrderDirection;
}

@InputType('IssueFilters')
export class IssueFilters {
  @Field(() => String, { nullable: true })
  assignee?: string | null;

  @Field(() => String, { nullable: true })
  createdBy?: string | null;

  // ponytail: mentioned is accepted and ignored; filter on issue_reference mentions when Ghost records them.
  @Field(() => String, { nullable: true })
  mentioned?: string | null;

  @Field(() => [String], { nullable: true })
  labels?: string[] | null;

  @Field(() => [IssueState], { nullable: true })
  states?: IssueState[] | null;
}
