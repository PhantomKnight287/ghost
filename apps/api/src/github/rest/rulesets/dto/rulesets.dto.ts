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

import type { RuleType } from '../../../../lib/rulesets/rulesets.types.js';
import { PATTERN_MAX_LENGTH } from '../../../../resources/rulesets/dto/ruleset.dto.js';

export class GithubBypassActorDTO {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'A repository role (2 maintain, 4 write, 5 admin) or a team id; ignored for `OrganizationAdmin`.',
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
    description: 'None of the rules Ghost supports takes any.',
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
