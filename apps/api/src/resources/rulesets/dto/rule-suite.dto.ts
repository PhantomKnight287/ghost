import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import {
  RULE_SUITE_PERIODS,
  type RuleSuitePeriod,
} from '../../../lib/rulesets/rule-suite-filter.js';
import {
  REQUIREMENTS,
  type Requirement,
  type RuleSuiteResult,
  type RuleType,
} from '../../../lib/rulesets/rulesets.types.js';

const RESULTS = schema.ruleSuiteResult.enumValues;
const CHECKED_ENFORCEMENTS = ['active', 'evaluate'] as const;

export class ListRuleSuitesQueryDTO {
  @ApiPropertyOptional({
    description: 'Only suites that checked this ruleset.',
  })
  @IsString()
  @IsOptional()
  rulesetId?: string;

  @ApiPropertyOptional({
    description: 'A full ref, or a branch or tag name, which matches either.',
  })
  @IsString()
  @IsOptional()
  ref?: string;

  @ApiPropertyOptional({ description: 'The login the actor had at the time.' })
  @IsString()
  @IsOptional()
  actor?: string;

  @ApiPropertyOptional({ enum: RESULTS })
  @IsIn(RESULTS)
  @IsOptional()
  result?: RuleSuiteResult;

  @ApiPropertyOptional({
    enum: CHECKED_ENFORCEMENTS,
    description: 'Only suites that checked a ruleset with this enforcement.',
  })
  @IsIn(CHECKED_ENFORCEMENTS)
  @IsOptional()
  enforcement?: (typeof CHECKED_ENFORCEMENTS)[number];

  @ApiPropertyOptional({ enum: RULE_SUITE_PERIODS, default: 'day' })
  @IsIn(RULE_SUITE_PERIODS)
  @IsOptional()
  period?: RuleSuitePeriod;

  @ApiPropertyOptional({
    description:
      'Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page.',
  })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page size.',
    minimum: 1,
    maximum: 100,
    default: 30,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class RuleSuiteActorDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: String, nullable: true })
  username: string | null;
}

export class RuleSuitePullRequestDTO {
  @ApiProperty()
  number: number;
}

export class RuleEvaluationDTO {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null once the ruleset is deleted.',
  })
  rulesetId: string | null;

  @ApiProperty({
    description: 'The ruleset’s name when the write was checked.',
  })
  rulesetName: string;

  @ApiProperty({ enum: ['active', 'evaluate', 'deleted ruleset'] })
  enforcement: 'active' | 'evaluate' | 'deleted ruleset';

  @ApiProperty({ enum: schema.rulesetRuleType.enumValues })
  rule: RuleType;

  @ApiProperty({ enum: schema.ruleEvaluationResult.enumValues })
  result: 'pass' | 'fail';

  @ApiProperty({
    enum: REQUIREMENTS,
    isArray: true,
    description: 'What a failed `pull_request` rule left unmet.',
  })
  requirements: Requirement[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The message the writer saw for a failure.',
  })
  details: string | null;
}

export class RuleSuiteDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: RuleSuiteActorDTO, nullable: true })
  actor: RuleSuiteActorDTO | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The actor’s login when they wrote.',
  })
  actorName: string | null;

  @ApiProperty()
  ref: string;

  @ApiProperty()
  beforeSha: string;

  @ApiProperty()
  afterSha: string;

  @ApiProperty({ enum: schema.ruleSuiteWrite.enumValues })
  write: (typeof schema.ruleSuiteWrite.enumValues)[number];

  @ApiProperty({ type: RuleSuitePullRequestDTO, nullable: true })
  pullRequest: RuleSuitePullRequestDTO | null;

  @ApiProperty({ enum: RESULTS })
  result: RuleSuiteResult;

  @ApiProperty({
    enum: RESULTS,
    nullable: true,
    description:
      'The result with evaluate rulesets counted as active; null when none applied.',
  })
  evaluationResult: RuleSuiteResult | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    type: [RuleEvaluationDTO],
    description: 'In the order the rules were checked.',
  })
  evaluations: RuleEvaluationDTO[];
}

export class ListRuleSuitesResponseDTO {
  @ApiProperty({ type: [RuleSuiteDTO], description: 'Newest first.' })
  ruleSuites: RuleSuiteDTO[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
