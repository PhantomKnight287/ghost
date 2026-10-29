import { schema } from '@ghost/db';
import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
  OmitType,
} from '@nestjs/swagger';
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
} from '../../../lib/rulesets/rulesets.types.js';

const TARGETS = schema.rulesetTarget.enumValues;
const RULE_TYPES = schema.rulesetRuleType.enumValues;
const ACTOR_TYPES = schema.rulesetBypassActorType.enumValues;
const BYPASS_MODES = schema.rulesetBypassMode.enumValues;
/** Git's own refs are rarely longer; the cap keeps a pattern cheap to match on every push. */
export const PATTERN_MAX_LENGTH = 255;
// Bypassing below write would let someone skip rules on refs they cannot write anyway.
const BYPASS_ROLES = ['write', 'maintain', 'admin'] as const;

export class RulesetRuleDTO {
  @ApiProperty({ enum: RULE_TYPES })
  @IsIn(RULE_TYPES)
  type: RuleType;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      "For `pull_request`: GitHub's parameters, defaults filled in for those left out. Other rules take none.",
    example: {
      required_approving_review_count: 1,
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: true,
      allowed_merge_methods: ['squash', 'rebase'],
    },
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

export class RulesetBypassActorDTO {
  @ApiProperty({ enum: ACTOR_TYPES })
  @IsIn(ACTOR_TYPES)
  actorType: (typeof ACTOR_TYPES)[number];

  @ApiPropertyOptional({
    enum: BYPASS_ROLES,
    description: 'For `RepositoryRole`: everyone with at least this role.',
  })
  @ValidateIf(
    (actor: RulesetBypassActorDTO) => actor.actorType === 'RepositoryRole',
  )
  @IsIn(BYPASS_ROLES)
  role?: (typeof BYPASS_ROLES)[number];

  @ApiPropertyOptional({
    description: "For `Team`: a team of the repository's organization.",
  })
  @ValidateIf((actor: RulesetBypassActorDTO) => actor.actorType === 'Team')
  @IsString()
  teamId?: string;

  @ApiPropertyOptional({
    description: "For `Integration`: an app's App ID. Its bot bypasses.",
  })
  @ValidateIf(
    (actor: RulesetBypassActorDTO) => actor.actorType === 'Integration',
  )
  @IsInt()
  appId?: number;

  @ApiProperty({
    enum: BYPASS_MODES,
    description:
      '`pull_request` skips the ruleset only when merging a pull request.',
  })
  @IsIn(BYPASS_MODES)
  bypassMode: (typeof BYPASS_MODES)[number];
}

export class RulesetPatternsDTO {
  @ApiProperty({ enum: TARGETS })
  @IsIn(TARGETS)
  target: (typeof TARGETS)[number];

  @ApiProperty({
    type: [String],
    description:
      'Ref name patterns, with or without the `refs/heads/` or `refs/tags/` prefix, or `~DEFAULT_BRANCH` and `~ALL`. `*` stays within one path segment, `**` crosses them.',
    example: ['main', 'release/*'],
  })
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(PATTERN_MAX_LENGTH, { each: true })
  include: string[];

  @ApiProperty({
    type: [String],
    description: 'Patterns that take a ref back out, whatever `include` says.',
  })
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(PATTERN_MAX_LENGTH, { each: true })
  exclude: string[];
}

export class RulesetRequestDTO extends RulesetPatternsDTO {
  @ApiProperty({ example: 'Protect main' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: schema.rulesetEnforcement.enumValues })
  @IsIn(schema.rulesetEnforcement.enumValues)
  enforcement: (typeof schema.rulesetEnforcement.enumValues)[number];

  @ApiProperty({ type: [RulesetBypassActorDTO] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RulesetBypassActorDTO)
  bypassActors: RulesetBypassActorDTO[];

  @ApiProperty({
    type: [RulesetRuleDTO],
    description: 'Each type at most once.',
  })
  @IsArray()
  @ArrayUnique((rule: RulesetRuleDTO) => rule?.type)
  @ValidateNested({ each: true })
  @Type(() => RulesetRuleDTO)
  rules: RulesetRuleDTO[];
}

export class RulesetDTO extends OmitType(RulesetRequestDTO, ['bypassActors']) {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({
    type: [RulesetBypassActorDTO],
    description: 'Left out for viewers who are not admins.',
  })
  bypassActors?: RulesetBypassActorDTO[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ListRulesetsResponseDTO {
  @ApiProperty({ type: [RulesetDTO] })
  rulesets: RulesetDTO[];
}

export class RulesetPreviewResponseDTO {
  @ApiProperty({
    type: [String],
    description: 'Every existing ref the patterns target, full form, sorted.',
  })
  refs: string[];
}

export class ProtectedRefsQueryDTO {
  @ApiProperty({ enum: TARGETS })
  @IsIn(TARGETS)
  target: (typeof TARGETS)[number];
}

export class ProtectedRefDTO {
  @ApiProperty({
    enum: RULE_TYPES,
    isArray: true,
    description: 'Every rule an active ruleset applies to the ref.',
  })
  rules: RuleType[];

  @ApiProperty({
    enum: ['always', 'pull_requests_only', 'never'],
    description:
      'How far the viewer may skip those rules: the least any one of the rulesets allows.',
  })
  bypass: BypassAnswer;
}

export class ProtectedRefsResponseDTO {
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(ProtectedRefDTO) },
  })
  refs: Record<string, ProtectedRefDTO>;
}
