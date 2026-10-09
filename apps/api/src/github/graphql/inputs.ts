import { Field, InputType } from '@nestjs/graphql';
import { Allow } from 'class-validator';

import { IssueOrderField, IssueState, LabelOrderField, OrderDirection } from './enums.js';

// GraphQL already checks every input's types and nullability; @Allow only keeps fields through the global ValidationPipe's whitelist.
@InputType('IssueOrder')
export class IssueOrder {
  @Allow()
  @Field(() => IssueOrderField)
  field: IssueOrderField;

  @Allow()
  @Field(() => OrderDirection)
  direction: OrderDirection;
}

@InputType('IssueFilters')
export class IssueFilters {
  @Allow()
  @Field(() => String, { nullable: true })
  assignee?: string | null;

  @Allow()
  @Field(() => String, { nullable: true })
  createdBy?: string | null;

  // ponytail: mentioned is accepted and ignored; filter on issue_reference mentions when Ghost records them.
  @Allow()
  @Field(() => String, { nullable: true })
  mentioned?: string | null;

  @Allow()
  @Field(() => [String], { nullable: true })
  labels?: string[] | null;

  @Allow()
  @Field(() => [IssueState], { nullable: true })
  states?: IssueState[] | null;
}

@InputType('LabelOrder')
export class LabelOrder {
  @Allow()
  @Field(() => LabelOrderField)
  field: LabelOrderField;

  @Allow()
  @Field(() => OrderDirection)
  direction: OrderDirection;
}
