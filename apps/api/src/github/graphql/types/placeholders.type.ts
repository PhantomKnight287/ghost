import {
  createUnionType,
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { IssueTypeColor, ReactionContent } from '../enums.js';
import { Node } from './node.interface.js';

/** Ghost has no milestones, reactions, issue types, projects or sub-issues. These types exist so gh's fixed queries validate; resolvers answer them empty. */

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
