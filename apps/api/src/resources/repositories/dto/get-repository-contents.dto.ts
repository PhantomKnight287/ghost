import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  isSafeTreePath,
  MAX_TREE_PATH_LENGTH,
} from '../../../services/git/tree/tree-path.js';

const TREE_ENTRY_TYPES = ['blob', 'tree', 'commit'] as const;

@ValidatorConstraint({ name: 'safeTreePath' })
export class SafeTreePathConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return isSafeTreePath(value);
  }

  defaultMessage() {
    return 'path must be a repository-relative directory, without "." or ".." segments';
  }
}

export class GetRepositoryContentsQueryDTO {
  @ApiPropertyOptional({
    description:
      'Directory to list, relative to the repository root. Omit for the root. ' +
      'Slashes may be sent percent-encoded (`src%2Fdeep`); they are decoded once, ' +
      'so an already-decoded `src/deep` works too.',
    example: 'src/services',
    maxLength: MAX_TREE_PATH_LENGTH,
  })
  @IsString()
  @MaxLength(MAX_TREE_PATH_LENGTH)
  @Validate(SafeTreePathConstraint)
  @IsOptional()
  path?: string;

  @ApiPropertyOptional({
    description:
      'Branch or commit sha to list. Accepts `main`, `refs/heads/main` or a ' +
      'commit sha. Omit for the default branch.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  ref?: string;
}

export class CommitSummaryDTO {
  @ApiProperty({ description: 'Full 40-character commit sha.' })
  @IsString()
  sha: string;

  @ApiProperty({
    description: 'Commit subject - the first line of the message.',
  })
  @IsString()
  message: string;

  @ApiProperty({ description: 'Committer timestamp, ISO 8601.' })
  @IsISO8601()
  committedAt: string;
}

export class TreeEntryDTO {
  @ApiProperty({ description: 'Entry name within the listed directory.' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Full path from the repository root.' })
  @IsString()
  path: string;

  @ApiProperty({
    enumName: 'TreeEntryType',
    enum: TREE_ENTRY_TYPES,
    description: '`tree` is a directory, `commit` a submodule.',
  })
  @IsString()
  type: (typeof TREE_ENTRY_TYPES)[number];

  @ApiProperty({
    description: 'Git file mode, e.g. `100644`.',
    example: '100644',
  })
  @IsString()
  mode: string;

  @ApiProperty({ description: 'Object id of the blob or tree.' })
  @IsString()
  oid: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Blob size in bytes; `null` for trees and submodules.',
  })
  @IsInt()
  @IsOptional()
  size: number | null;

  @ApiProperty({
    type: CommitSummaryDTO,
    nullable: true,
    description:
      'Newest commit touching this entry, or anything beneath it for a tree. ' +
      '`null` only if the index has not caught up with the ref.',
  })
  @ValidateNested()
  @Type(() => CommitSummaryDTO)
  @IsOptional()
  lastCommit: CommitSummaryDTO | null;
}

export class GetRepositoryContentsResponseDTO {
  @ApiProperty({
    description: 'Ref that was listed, always fully qualified.',
    example: 'refs/heads/main',
  })
  @IsString()
  ref: string;

  @ApiProperty({
    description:
      'Normalized directory that was listed, with a trailing slash. Empty at the root.',
    example: 'src/services/',
  })
  @IsString()
  path: string;

  @ApiProperty({
    description: 'Commits reachable from the ref. `0` for an unborn ref.',
    example: 128,
  })
  @IsInt()
  commitCount: number;

  @ApiProperty({
    type: CommitSummaryDTO,
    nullable: true,
    description:
      'Tip commit of the ref. `null` when nothing has been pushed yet.',
  })
  @ValidateNested()
  @Type(() => CommitSummaryDTO)
  @IsOptional()
  commit: CommitSummaryDTO | null;

  @ApiProperty({
    type: [TreeEntryDTO],
    description:
      'One level of the directory: directories first (submodules among them), then files, ' +
      'each group alphabetical. Case is a minor difference, so `readme.md` and `README.md` sit ' +
      'together rather than in separate blocks, and embedded numbers order naturally ' +
      '(`file2` before `file10`). Empty for an unborn ref or a path that is not a directory.',
  })
  @ValidateNested({ each: true })
  @Type(() => TreeEntryDTO)
  entries: TreeEntryDTO[];
}
