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
  PullRequestAllowedMergeMethods,
  RepositoryRulesetBypassActorBypassMode,
  RepositoryRulesetTarget,
  RepositoryRuleType,
  RuleEnforcement,
} from '../enums.js';
import { Node } from './node.interface.js';

@ObjectType('PullRequestParameters')
export class PullRequestParametersNode {
  kind = 'PullRequestParameters';

  @Field(() => [PullRequestAllowedMergeMethods], { nullable: true })
  allowedMergeMethods: PullRequestAllowedMergeMethods[];

  @Field()
  dismissStaleReviewsOnPush: boolean;

  @Field()
  requireCodeOwnerReview: boolean;

  @Field()
  requireLastPushApproval: boolean;

  @Field(() => Int)
  requiredApprovingReviewCount: number;

  @Field()
  requiredReviewThreadResolution: boolean;
}

@ObjectType('StatusCheckConfiguration')
export class StatusCheckConfigurationNode {
  @Field()
  context: string;

  /** Always null until Ghost Apps (#50): a check cannot be pinned to an app yet. */
  @Field(() => Int, { nullable: true })
  integrationId: number | null;
}

@ObjectType('RequiredStatusChecksParameters')
export class RequiredStatusChecksParametersNode {
  kind = 'RequiredStatusChecksParameters';

  @Field({ nullable: true })
  doNotEnforceOnCreate: boolean;

  @Field(() => [StatusCheckConfigurationNode])
  requiredStatusChecks: StatusCheckConfigurationNode[];

  @Field()
  strictRequiredStatusChecksPolicy: boolean;
}

/** GitHub's union of every rule's parameters; `pull_request` and `required_status_checks` are the Ghost rules that take any. */
export const RuleParameters = createUnionType({
  name: 'RuleParameters',
  types: () =>
    [PullRequestParametersNode, RequiredStatusChecksParametersNode] as const,
  resolveType: (value: { kind: string }) => value.kind,
});

@ObjectType('RepositoryRule', { implements: () => [Node] })
export class RepositoryRuleNode {
  kind = 'RepositoryRule';

  @Field(() => ID)
  id: string;

  @Field(() => RepositoryRuleType)
  type: RepositoryRuleType;

  @Field(() => RuleParameters, { nullable: true })
  parameters:
    | PullRequestParametersNode
    | RequiredStatusChecksParametersNode
    | null;
}

export const RepositoryRuleConnection = Connection(
  RepositoryRuleNode,
  'RepositoryRule',
);

@ObjectType('RepositoryRulesetBypassActor', { implements: () => [Node] })
export class RepositoryRulesetBypassActorNode {
  kind = 'RepositoryRulesetBypassActor';

  @Field(() => ID)
  id: string;

  @Field(() => RepositoryRulesetBypassActorBypassMode, { nullable: true })
  bypassMode: RepositoryRulesetBypassActorBypassMode;

  @Field()
  deployKey: boolean;

  @Field()
  organizationAdmin: boolean;

  @Field(() => Int, { nullable: true })
  repositoryRoleDatabaseId: number | null;

  @Field(() => String, { nullable: true })
  repositoryRoleName: string | null;
}

export const RepositoryRulesetBypassActorConnection = Connection(
  RepositoryRulesetBypassActorNode,
  'RepositoryRulesetBypassActor',
);

@ObjectType('RefNameConditionTarget')
export class RefNameConditionTargetNode {
  @Field(() => [String])
  include: string[];

  @Field(() => [String])
  exclude: string[];
}

@ObjectType('RepositoryRuleConditions')
export class RepositoryRuleConditionsNode {
  @Field(() => RefNameConditionTargetNode, { nullable: true })
  refName: RefNameConditionTargetNode;
}

@ObjectType('RepositoryRuleset', { implements: () => [Node] })
export class RepositoryRulesetNode {
  kind = 'RepositoryRuleset';
  ruleNodes: RepositoryRuleNode[];
  /** Empty unless the viewer administers the repository, as on GitHub. */
  bypassActorNodes: RepositoryRulesetBypassActorNode[];

  @Field(() => ID)
  id: string;

  @Field(() => Int, { nullable: true })
  databaseId: number;

  @Field()
  name: string;

  @Field(() => RepositoryRulesetTarget, { nullable: true })
  target: RepositoryRulesetTarget;

  @Field(() => RuleEnforcement)
  enforcement: RuleEnforcement;

  @Field(() => RepositoryRuleConditionsNode)
  conditions: RepositoryRuleConditionsNode;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt: Date;
}

export const RepositoryRulesetConnection = Connection(
  RepositoryRulesetNode,
  'RepositoryRuleset',
);
