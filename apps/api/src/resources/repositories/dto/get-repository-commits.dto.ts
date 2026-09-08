import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { MAX_TREE_PATH_LENGTH } from '../../../services/git/tree/tree-path.js';
import { SafeTreePathConstraint } from './get-repository-contents.dto.js';

export class GetRepositoryCommitsQueryDTO {
  @ApiPropertyOptional({
    description: 'Branch or commit sha to walk. Omit for the default branch.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  ref?: string;

  @ApiPropertyOptional({
    description: 'Only commits touching this path.',
    example: 'apps/api',
    maxLength: MAX_TREE_PATH_LENGTH,
  })
  @IsString()
  @MaxLength(MAX_TREE_PATH_LENGTH)
  @Validate(SafeTreePathConstraint)
  @IsOptional()
  path?: string;

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

export class CommitDTO {
  @ApiProperty({ description: 'Full 40-character commit sha.' })
  @IsString()
  sha: string;

  @ApiProperty({
    description: 'Commit subject, the first line of the message.',
  })
  @IsString()
  subject: string;

  @ApiProperty({
    description: 'The rest of the message. Empty when there is none.',
  })
  @IsString()
  body: string;

  @ApiProperty()
  @IsString()
  authorName: string;

  @ApiProperty()
  @IsString()
  authorEmail: string;

  @ApiProperty({ description: 'Committer timestamp, ISO 8601.' })
  @IsISO8601()
  committedAt: string;
}

export class GetRepositoryCommitsResponseDTO {
  @ApiProperty({
    description: 'Ref that was walked, always fully qualified.',
    example: 'refs/heads/main',
  })
  @IsString()
  ref: string;

  @ApiProperty({
    description:
      "Position of this page's first commit in the walk, 1-based. `0` when the page is empty.",
    example: 41,
  })
  @IsInt()
  from: number;

  @ApiProperty({
    description:
      "Position of this page's last commit. `0` when the page is empty.",
    example: 60,
  })
  @IsInt()
  to: number;

  @ApiProperty({
    description:
      'Commits the walk can reach in total, narrowed by `path` when one is given.',
    example: 128,
  })
  @IsInt()
  total: number;

  @ApiProperty({ type: [CommitDTO], description: 'Newest first.' })
  @ValidateNested({ each: true })
  @Type(() => CommitDTO)
  commits: CommitDTO[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Pass back as `cursor` for the next page. `null` on the last page.',
  })
  @IsString()
  @IsOptional()
  nextCursor: string | null;
}

export class CommitFileDTO {
  @ApiProperty({ description: '`A` added, `M` modified, `D` deleted.' })
  @IsString()
  status: string;

  @ApiProperty()
  @IsString()
  path: string;
}

export class GetRepositoryCommitResponseDTO extends CommitDTO {
  @ApiProperty({
    type: [CommitFileDTO],
    description: 'Paths this commit changed, against its first parent.',
  })
  @ValidateNested({ each: true })
  @Type(() => CommitFileDTO)
  files: CommitFileDTO[];
}

export class GetCommitPatchQueryDTO {
  @ApiPropertyOptional({ description: 'Limit the patch to one path.' })
  @IsString()
  @IsOptional()
  @MaxLength(4096)
  path?: string;
}
