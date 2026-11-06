import {
  createUnionType,
  Field,
  GraphQLISODateTime,
  ID,
  ObjectType,
} from '@nestjs/graphql';

import { Connection } from '../connection.js';
import {
  CheckConclusionState,
  CheckStatusState,
  StatusState,
} from '../enums.js';
import { URI } from '../scalars.js';
import { Node } from './node.interface.js';

/** Ghost has no Actions; these exist so gh's checks query validates, and `workflowRun` is always null. */
@ObjectType('Workflow', { implements: () => [Node] })
export class WorkflowNode {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;
}

@ObjectType('WorkflowRun', { implements: () => [Node] })
export class WorkflowRunNode {
  @Field(() => ID)
  id: string;

  @Field(() => WorkflowNode)
  workflow: WorkflowNode;
}

@ObjectType('CheckSuite', { implements: () => [Node] })
export class CheckSuiteNode {
  kind = 'CheckSuite';

  @Field(() => ID)
  id: string;

  @Field(() => WorkflowRunNode, { nullable: true })
  workflowRun: WorkflowRunNode | null;
}

@ObjectType('CheckRun', { implements: () => [Node] })
export class CheckRunNode {
  kind = 'CheckRun';

  /** The Ghost repository whose rollup holds this run, for isRequired's pull request number; not a GraphQL field. */
  repositoryId: string;

  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => CheckStatusState)
  status: CheckStatusState;

  @Field(() => CheckConclusionState, { nullable: true })
  conclusion: CheckConclusionState | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  startedAt: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  completedAt: Date | null;

  @Field(() => URI, { nullable: true })
  detailsUrl: string | null;

  @Field(() => String, { nullable: true })
  title: string | null;

  @Field(() => String, { nullable: true })
  summary: string | null;

  @Field(() => String, { nullable: true })
  text: string | null;

  @Field(() => CheckSuiteNode)
  checkSuite: CheckSuiteNode;
}

@ObjectType('StatusContext', { implements: () => [Node] })
export class StatusContextNode {
  kind = 'StatusContext';

  /** The Ghost repository whose rollup holds this status, for isRequired's pull request number; not a GraphQL field. */
  repositoryId: string;

  @Field(() => ID)
  id: string;

  @Field()
  context: string;

  @Field(() => StatusState)
  state: StatusState;

  @Field(() => URI, { nullable: true })
  targetUrl: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => String, { nullable: true })
  description: string | null;
}

export const StatusCheckRollupContext = createUnionType({
  name: 'StatusCheckRollupContext',
  types: () => [CheckRunNode, StatusContextNode] as const,
  resolveType: (value: { kind: string }) => value.kind,
});

export const StatusCheckRollupContextConnection = Connection(
  StatusCheckRollupContext,
  'StatusCheckRollupContext',
);

/** A commit's statuses and check runs; null when it has neither. StatusCheckRollupResolver pages `contexts`. */
@ObjectType('StatusCheckRollup', { implements: () => [Node] })
export class StatusCheckRollupNode {
  kind = 'StatusCheckRollup';

  @Field(() => ID)
  id: string;

  @Field(() => StatusState)
  state: StatusState;

  contexts: (CheckRunNode | StatusContextNode)[];
}
