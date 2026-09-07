import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { MAX_TREE_PATH_LENGTH } from '../../../services/git/tree/tree-path.js';
import {
  CommitSummaryDTO,
  SafeTreePathConstraint,
} from './get-repository-contents.dto.js';

export class GetRepositoryBlobQueryDTO {
  @ApiProperty({
    description: 'File to read, relative to the repository root.',
    example: 'src/main.ts',
    maxLength: MAX_TREE_PATH_LENGTH,
  })
  @IsString()
  @MaxLength(MAX_TREE_PATH_LENGTH)
  @Validate(SafeTreePathConstraint)
  path: string;

  @ApiPropertyOptional({
    description:
      'Branch, tag-free ref or commit sha to read from. Accepts `main`, ' +
      '`refs/heads/main` or a commit sha. Omit for the default branch.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  ref?: string;
}

export class GetRepositoryBlobResponseDTO {
  @ApiProperty({
    description: 'Ref that was read, always fully qualified.',
    example: 'refs/heads/main',
  })
  @IsString()
  ref: string;

  @ApiProperty({
    description: 'Normalized path of the file.',
    example: 'src/main.ts',
  })
  @IsString()
  path: string;

  @ApiProperty({ description: 'Object id of the blob.' })
  @IsString()
  oid: string;

  @ApiProperty({ description: 'File size in bytes.' })
  @IsInt()
  size: number;

  @ApiProperty({
    enumName: 'BlobEncoding',
    enum: ['utf-8', 'base64'],
    description:
      '`base64` for binary files, and for anything that is not valid UTF-8.',
  })
  @IsString()
  encoding: 'utf-8' | 'base64';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'File contents, `null` when the file is past the inline size limit.',
  })
  @IsString()
  @IsOptional()
  content: string | null;

  @ApiProperty({
    type: CommitSummaryDTO,
    nullable: true,
    description: 'Newest commit touching this file.',
  })
  @ValidateNested()
  @Type(() => CommitSummaryDTO)
  @IsOptional()
  commit: CommitSummaryDTO | null;
}
