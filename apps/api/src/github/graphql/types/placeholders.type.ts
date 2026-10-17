import {
  createUnionType,
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';

import { Connection } from '../connection.js';
import {
  CheckConclusionState,
  CheckStatusState,
  IssueTypeColor,
  PullRequestMergeMethod,
  ReactionContent,
  StatusState,
} from '../enums.js';
import { URI } from '../scalars.js';
import { Actor, Node, UniformResourceLocatable } from './node.interface.js';
import { OrganizationNode } from './organization.type.js';

/** Ghost has no milestones, reactions, issue types, projects, sub-issues, check runs, teams, bots, auto-merge or branch protection. These types exist so gh's fixed queries validate; resolvers answer them empty. */

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

@ObjectType('IssueType', { implements: () => [Node] })
export class IssueTypeNode {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => IssueTypeColor)
  color: IssueTypeColor;
}

@ObjectType('ProjectV2')
export class ProjectV2Node {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;
}

@ObjectType('ProjectV2ItemFieldSingleSelectValue')
export class ProjectV2ItemFieldSingleSelectValue {
  @Field(() => ID)
  id: string;

  @Field(() => String, { nullable: true })
  name: string | null;

  @Field(() => String, { nullable: true })
  optionId: string | null;
}

export const ProjectV2ItemFieldValue = createUnionType({
  name: 'ProjectV2ItemFieldValue',
  types: () => [ProjectV2ItemFieldSingleSelectValue] as const,
});

@ObjectType('ProjectV2Item')
export class ProjectV2ItemNode {
  @Field(() => ID)
  id: string;

  @Field(() => ProjectV2Node)
  project: ProjectV2Node;
}

export const ProjectV2ItemConnection = Connection(
  ProjectV2ItemNode,
  'ProjectV2Item',
);

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
  @Field(() => ID)
  id: string;

  @Field(() => WorkflowRunNode, { nullable: true })
  workflowRun: WorkflowRunNode | null;
}

@ObjectType('CheckRun', { implements: () => [Node] })
export class CheckRunNode {
  kind = 'CheckRun';

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

  @Field(() => CheckSuiteNode)
  checkSuite: CheckSuiteNode;
}

@ObjectType('StatusContext', { implements: () => [Node] })
export class StatusContextNode {
  kind = 'StatusContext';

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

/** A commit's combined commit statuses; null when it has none. StatusCheckRollupResolver pages `contexts`. */
@ObjectType('StatusCheckRollup', { implements: () => [Node] })
export class StatusCheckRollupNode {
  kind = 'StatusCheckRollup';

  @Field(() => ID)
  id: string;

  @Field(() => StatusState)
  state: StatusState;

  contexts: StatusContextNode[];
}

@ObjectType('BranchProtectionRule', { implements: () => [Node] })
export class BranchProtectionRuleNode {
  @Field(() => ID)
  id: string;

  @Field()
  requiresStrictStatusChecks: boolean;
}

@ObjectType('AutoMergeRequest')
export class AutoMergeRequestNode {
  @Field(() => String, { nullable: true })
  authorEmail: string | null;

  @Field(() => String, { nullable: true })
  commitBody: string | null;

  @Field(() => String, { nullable: true })
  commitHeadline: string | null;

  @Field(() => PullRequestMergeMethod)
  mergeMethod: PullRequestMergeMethod;

  @Field(() => GraphQLISODateTime, { nullable: true })
  enabledAt: Date | null;

  @Field(() => Actor, { nullable: true })
  enabledBy: Actor | null;
}

@ObjectType('Team', { implements: () => [Node] })
export class TeamNode {
  kind = 'Team';

  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field(() => OrganizationNode)
  organization: OrganizationNode;
}

@ObjectType('Bot', {
  implements: () => [Node, Actor, UniformResourceLocatable],
})
export class BotNode {
  kind = 'Bot';

  @Field(() => ID)
  id: string;

  @Field()
  login: string;

  @Field(() => URI)
  avatarUrl: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;
}
