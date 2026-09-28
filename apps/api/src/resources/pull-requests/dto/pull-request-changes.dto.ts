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

import { CommitDTO } from '../../repositories/dto/get-repository-commits.dto.js';

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

export class PullRequestFileDTO {
  @ApiProperty({ description: '`A` added, `M` modified, `D` deleted.' })
  @IsString()
  status: string;

  @ApiProperty()
  @IsString()
  path: string;

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
