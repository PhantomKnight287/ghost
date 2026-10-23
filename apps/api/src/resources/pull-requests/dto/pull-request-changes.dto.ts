import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  CommitDTO,
  CommitFileDTO,
} from '../../repositories/dto/get-repository-commits.dto.js';
import {
  REQUIREMENTS,
  type Requirement,
} from '../../../lib/rulesets/rulesets.types.js';

export class GetPullRequestCommitsQueryDTO {
  @ApiPropertyOptional({
    description: 'Sha to resume from, taken from a previous `nextCursor`.',
  })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class GetPullRequestCommitsResponseDTO {
  @ApiProperty({ type: [CommitDTO], description: 'Newest first.' })
  @ValidateNested({ each: true })
  @Type(() => CommitDTO)
  commits: CommitDTO[];

  @ApiProperty()
  @IsInt()
  total: number;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  nextCursor: string | null;
}

export class PullRequestCommitPositionDTO {
  @ApiProperty({
    description:
      "Where the commit falls among the pull request's commits, counting from 1 at the oldest.",
  })
  @IsInt()
  position: number;

  @ApiProperty()
  @IsInt()
  total: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The commit listed just before it, older; null for the oldest.',
  })
  @IsString()
  @IsOptional()
  previousSha: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The commit listed just after it, newer; null for the head.',
  })
  @IsString()
  @IsOptional()
  nextSha: string | null;
}

export class PullRequestFileDTO extends CommitFileDTO {
  @ApiProperty()
  @IsInt()
  additions: number;

  @ApiProperty()
  @IsInt()
  deletions: number;

  @ApiProperty({ description: 'Line counts are meaningless when true.' })
  @IsBoolean()
  binary: boolean;
}

export class GetPullRequestFilesResponseDTO {
  @ApiProperty({
    description:
      'Commit the diff is taken from, the merge base of the two branches.',
  })
  @IsString()
  from: string;

  @ApiProperty({ description: 'Head tip the diff is taken to.' })
  @IsString()
  to: string;

  @ApiProperty({ type: [PullRequestFileDTO] })
  @ValidateNested({ each: true })
  @Type(() => PullRequestFileDTO)
  files: PullRequestFileDTO[];
}

export class GetPullRequestPatchQueryDTO {
  @ApiPropertyOptional({ description: 'Limit the patch to one path.' })
  @IsString()
  @IsOptional()
  @MaxLength(4096)
  path?: string;
}

export const MERGE_METHODS = ['merge', 'squash', 'rebase'] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export class MergePullRequestRequestDTO {
  @ApiPropertyOptional({
    description:
      'Subject of the merge or squash commit. A rebase keeps every commit message and ignores it.',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description:
      "Body of the squash commit. Defaults to the head's commit messages; an empty string leaves the body out. Ignored by the other methods.",
  })
  @IsString()
  @IsOptional()
  @MaxLength(65536)
  message?: string;

  @ApiPropertyOptional({
    enumName: 'MergeMethod',
    enum: MERGE_METHODS,
    default: 'merge',
    description:
      '`merge` adds a merge commit, `squash` lands the whole request as one commit, `rebase` replays each of its commits onto the base.',
  })
  @IsIn(MERGE_METHODS)
  @IsOptional()
  method?: MergeMethod;

  @ApiPropertyOptional({
    description:
      'The viewer chose to merge over the ruleset requirements they may bypass. Without it a merge that would bypass any is refused.',
  })
  @IsBoolean()
  @IsOptional()
  bypassRules?: boolean;
}

export class MergeRequirementsQueryDTO {
  @ApiPropertyOptional({
    enumName: 'MergeMethod',
    enum: MERGE_METHODS,
    description: 'Left out, the first method the rulesets allow is judged.',
  })
  @IsIn(MERGE_METHODS)
  @IsOptional()
  method?: MergeMethod;
}

export class RuleViolationDTO {
  @ApiProperty({ example: 'refs/heads/main' })
  @IsString()
  ref: string;

  @ApiProperty()
  @IsString()
  rulesetId: string;

  @ApiProperty()
  @IsString()
  rulesetName: string;

  @ApiProperty({
    enumName: 'RuleType',
    enum: schema.rulesetRuleType.enumValues,
  })
  @IsIn(schema.rulesetRuleType.enumValues)
  rule: (typeof schema.rulesetRuleType.enumValues)[number];

  @ApiPropertyOptional({
    enumName: 'RuleRequirement',
    enum: REQUIREMENTS,
    description: 'Which part of a `pull_request` rule is unmet.',
  })
  @IsIn(REQUIREMENTS)
  @IsOptional()
  requirement?: Requirement;

  @ApiProperty()
  @IsString()
  message: string;
}

export class MergeRequirementsDTO {
  @ApiProperty({
    type: [RuleViolationDTO],
    description:
      'Unmet requirements the viewer cannot bypass; any one blocks the merge.',
  })
  @ValidateNested({ each: true })
  @Type(() => RuleViolationDTO)
  violations: RuleViolationDTO[];

  @ApiProperty({
    type: [RuleViolationDTO],
    description:
      'Unmet requirements the viewer may bypass by merging with `bypassRules`.',
  })
  @ValidateNested({ each: true })
  @Type(() => RuleViolationDTO)
  bypassed: RuleViolationDTO[];

  @ApiProperty({
    enumName: 'MergeMethod',
    enum: MERGE_METHODS,
    isArray: true,
    description: 'The merge methods every applicable ruleset allows.',
  })
  @IsIn(MERGE_METHODS, { each: true })
  allowedMethods: MergeMethod[];

  @ApiProperty({
    description: 'A rule on the base asks for approvals or code owner reviews.',
  })
  @IsBoolean()
  reviewsRequired: boolean;
}

export class MergePullRequestResponseDTO {
  @ApiProperty({
    description:
      'The new base tip: the merge commit, the squashed commit, or the last rebased one.',
  })
  @IsString()
  mergeCommitSha: string;

  @ApiProperty({ description: 'Sequence the merge landed at in the base log.' })
  @IsInt()
  seq: number;
}
