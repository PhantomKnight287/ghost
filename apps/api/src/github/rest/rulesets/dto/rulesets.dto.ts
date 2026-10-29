import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import type {
  BypassAnswer,
  RuleType,
} from '../../../../lib/rulesets/rulesets.types.js';
import { PATTERN_MAX_LENGTH } from '../../../../resources/rulesets/dto/ruleset.dto.js';
import { GithubPageQueryDTO } from '../../issues/dto/issue.dto.js';
import { GithubLinkDTO } from '../../pulls/dto/pull.dto.js';
import { GithubSimpleUserDTO } from '../../users/dto/user.dto.js';

export class GithubBypassActorDTO {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'A repository role (2 maintain, 4 write, 5 admin), a team id or an App ID; ignored for `OrganizationAdmin`.',
  })
  @ValidateIf(
    (actor: GithubBypassActorDTO) => actor.actor_type !== 'OrganizationAdmin',
  )
  @IsInt()
  actor_id?: number | null;

  @ApiProperty({ enum: schema.rulesetBypassActorType.enumValues })
  @IsIn(schema.rulesetBypassActorType.enumValues)
  actor_type: (typeof schema.rulesetBypassActorType.enumValues)[number];

  @ApiPropertyOptional({
    enum: schema.rulesetBypassMode.enumValues,
    default: 'always',
  })
  @IsOptional()
  @IsIn(schema.rulesetBypassMode.enumValues)
  bypass_mode?: (typeof schema.rulesetBypassMode.enumValues)[number];
}

/** Either list may be left out: an empty one on create, the current one on update. */
export class GithubRefNameConditionDTO {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(PATTERN_MAX_LENGTH, { each: true })
  include?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(PATTERN_MAX_LENGTH, { each: true })
  exclude?: string[];
}

export class GithubRulesetConditionsDTO {
  @ApiProperty({ type: GithubRefNameConditionDTO })
  @ValidateNested()
  @Type(() => GithubRefNameConditionDTO)
  ref_name: GithubRefNameConditionDTO;
}

export class GithubRulesetRuleDTO {
  @ApiProperty({ enum: schema.rulesetRuleType.enumValues })
  @IsIn(schema.rulesetRuleType.enumValues)
  type: RuleType;

  @ApiPropertyOptional({
    description:
      "For `pull_request`: GitHub's parameters. The other rules Ghost supports take none.",
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

export class GithubCreateRulesetDTO {
  // The same limits as RulesetRequestDTO: RulesetsService stores what its callers validated.
  @ApiProperty()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    enum: schema.rulesetTarget.enumValues,
    default: 'branch',
  })
  @IsOptional()
  @IsIn(schema.rulesetTarget.enumValues)
  target?: (typeof schema.rulesetTarget.enumValues)[number];

  @ApiProperty({ enum: schema.rulesetEnforcement.enumValues })
  @IsIn(schema.rulesetEnforcement.enumValues)
  enforcement: (typeof schema.rulesetEnforcement.enumValues)[number];

  @ApiPropertyOptional({ type: [GithubBypassActorDTO] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GithubBypassActorDTO)
  bypass_actors?: GithubBypassActorDTO[];

  @ApiPropertyOptional({ type: GithubRulesetConditionsDTO })
  @IsOptional()
  @ValidateNested()
  @Type(() => GithubRulesetConditionsDTO)
  conditions?: GithubRulesetConditionsDTO;

  @ApiPropertyOptional({ type: [GithubRulesetRuleDTO] })
  @IsOptional()
  @IsArray()
  @ArrayUnique((rule: GithubRulesetRuleDTO) => rule?.type)
  @ValidateNested({ each: true })
  @Type(() => GithubRulesetRuleDTO)
  rules?: GithubRulesetRuleDTO[];
}

/** GitHub's update changes only the fields it is given. */
export class GithubUpdateRulesetDTO extends PartialType(
  GithubCreateRulesetDTO,
) {}

const TIME_PERIODS = ['hour', 'day', 'week', 'month'] as const;
const SUITE_RESULTS = ['pass', 'fail', 'bypass', 'all'] as const;
const EVALUATE_STATUSES = ['all', 'active', 'evaluate'] as const;

/** GitHub's rule-suites list filters; an unknown value is GitHub's 422. */
export class GithubRuleSuitesQueryDTO extends GithubPageQueryDTO {
  @ApiPropertyOptional({
    description: 'No wildcards; `refs/heads/` or `refs/tags/` is optional.',
  })
  @IsString()
  @IsOptional()
  ref?: string;

  @ApiPropertyOptional({ enum: TIME_PERIODS, default: 'day' })
  @IsIn(TIME_PERIODS)
  @IsOptional()
  time_period?: (typeof TIME_PERIODS)[number];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  actor_name?: string;

  @ApiPropertyOptional({ enum: SUITE_RESULTS, default: 'all' })
  @IsIn(SUITE_RESULTS)
  @IsOptional()
  rule_suite_result?: (typeof SUITE_RESULTS)[number];

  @ApiPropertyOptional({ enum: EVALUATE_STATUSES, default: 'all' })
  @IsIn(EVALUATE_STATUSES)
  @IsOptional()
  evaluate_status?: (typeof EVALUATE_STATUSES)[number];
}

export class GithubRuleSuiteQueryDTO {
  @ApiPropertyOptional({
    default: false,
    description: 'Adds the pull request to a merge’s `pull_request` rule.',
  })
  @IsIn(['true', 'false'])
  @IsOptional()
  include_metadata?: 'true' | 'false';
}

export class GithubRulesetLinksDTO {
  @ApiProperty({ type: GithubLinkDTO })
  self: GithubLinkDTO;

  @ApiProperty({ type: GithubLinkDTO })
  html: GithubLinkDTO;
}

/** A ruleset as GitHub lists it: no conditions, rules or bypass actors. */
export class GithubRulesetSummaryDTO {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: schema.rulesetTarget.enumValues })
  target: (typeof schema.rulesetTarget.enumValues)[number];

  @ApiProperty({ example: 'Repository' })
  source_type: string;

  @ApiProperty({ example: 'octocat/hello-world' })
  source: string;

  @ApiProperty({ enum: schema.rulesetEnforcement.enumValues })
  enforcement: (typeof schema.rulesetEnforcement.enumValues)[number];

  @ApiProperty()
  node_id: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({ type: GithubRulesetLinksDTO })
  _links: GithubRulesetLinksDTO;
}

export class GithubRulesetDTO extends GithubRulesetSummaryDTO {
  @ApiProperty({ type: GithubRulesetConditionsDTO })
  conditions: GithubRulesetConditionsDTO;

  @ApiProperty({ type: [GithubRulesetRuleDTO] })
  rules: GithubRulesetRuleDTO[];

  @ApiPropertyOptional({
    type: [GithubBypassActorDTO],
    description: 'Admins only.',
  })
  bypass_actors?: GithubBypassActorDTO[];

  @ApiProperty({ enum: ['always', 'pull_requests_only', 'never'] })
  current_user_can_bypass: BypassAnswer;
}

export class GithubBranchRuleDTO extends GithubRulesetRuleDTO {
  @ApiProperty({ example: 'Repository' })
  ruleset_source_type: string;

  @ApiProperty({ example: 'octocat/hello-world' })
  ruleset_source: string;

  @ApiProperty()
  ruleset_id: number;
}

export class GithubRuleSuiteDTO {
  @ApiProperty()
  id: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null once the account is deleted.',
  })
  actor_id: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The login at the time of the write.',
  })
  actor_name: string | null;

  @ApiProperty()
  before_sha: string;

  @ApiProperty()
  after_sha: string;

  @ApiProperty({ example: 'refs/heads/main' })
  ref: string;

  @ApiProperty({ format: 'date-time' })
  pushed_at: Date;

  @ApiProperty({ enum: schema.ruleSuiteResult.enumValues })
  result: (typeof schema.ruleSuiteResult.enumValues)[number];

  @ApiProperty({
    type: String,
    enum: schema.ruleSuiteResult.enumValues,
    nullable: true,
    description:
      'What the rules in evaluate mode would have decided; null when none ran.',
  })
  evaluation_result: (typeof schema.ruleSuiteResult.enumValues)[number] | null;

  @ApiProperty()
  repository_id: number;

  @ApiProperty()
  repository_name: string;
}

export class GithubRuleSourceDTO {
  @ApiProperty({ example: 'ruleset' })
  type: 'ruleset';

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null once the ruleset is deleted.',
  })
  id: number | null;

  @ApiProperty({ description: 'The name at the time of the write.' })
  name: string;
}

export class GithubRuleSuiteReviewDTO {
  @ApiProperty()
  id: number;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  user: GithubSimpleUserDTO | null;

  @ApiProperty({
    enum: [
      'PENDING',
      'COMMENTED',
      'APPROVED',
      'CHANGES_REQUESTED',
      'DISMISSED',
    ],
  })
  state: string;
}

export class GithubRuleSuitePullRequestDTO {
  @ApiProperty()
  id: number;

  @ApiProperty()
  number: number;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  user: GithubSimpleUserDTO | null;

  @ApiProperty({ type: [GithubRuleSuiteReviewDTO] })
  reviews: GithubRuleSuiteReviewDTO[];
}

export class GithubRuleEvaluationMetadataDTO {
  @ApiProperty({ type: GithubRuleSuitePullRequestDTO })
  pull_request: GithubRuleSuitePullRequestDTO;
}

export class GithubRuleEvaluationDTO {
  @ApiProperty({ type: GithubRuleSourceDTO })
  rule_source: GithubRuleSourceDTO;

  @ApiProperty({
    enum: [...schema.rulesetEnforcement.enumValues, 'deleted ruleset'],
  })
  enforcement: string;

  @ApiProperty({ enum: schema.ruleEvaluationResult.enumValues })
  result: (typeof schema.ruleEvaluationResult.enumValues)[number];

  @ApiProperty({ enum: schema.rulesetRuleType.enumValues })
  rule_type: RuleType;

  @ApiProperty({ type: String, nullable: true })
  details: string | null;

  @ApiPropertyOptional({
    type: GithubRuleEvaluationMetadataDTO,
    description:
      'With `include_metadata=true`, on the `pull_request` rule of a merge only.',
  })
  metadata?: GithubRuleEvaluationMetadataDTO;
}

export class GithubRuleSuiteDetailDTO extends GithubRuleSuiteDTO {
  @ApiProperty({ type: [GithubRuleEvaluationDTO] })
  rule_evaluations: GithubRuleEvaluationDTO[];
}
