import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';

import { MAX_TREE_PATH_LENGTH } from '../../../lib/git/tree/tree-path.js';
import { SafeTreePathConstraint } from './get-repository-contents.dto.js';

// Express parses at most 1,000 query keys and drops the rest silently, so the cap sits well below that to answer 400 rather than a short list.
export const MAX_CODEOWNERS_PATHS = 500;

export class GetCodeownersQueryDTO {
  @ApiPropertyOptional({
    description:
      'Branch, tag or commit sha to read the CODEOWNERS file from. Omit for the default branch.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  ref?: string;
}

export class GetCodeownersOwnersQueryDTO extends GetCodeownersQueryDTO {
  @ApiProperty({
    description:
      'Files to name the owners of, relative to the repository root. Repeat the parameter for each file.',
    example: ['src/main.ts'],
    type: [String],
    maxItems: MAX_CODEOWNERS_PATHS,
  })
  // One `path=` arrives as a string, several as an array.
  @Transform(({ value }: { value: unknown }) => [value].flat())
  @IsArray()
  @ArrayMaxSize(MAX_CODEOWNERS_PATHS)
  @IsString({ each: true })
  @MaxLength(MAX_TREE_PATH_LENGTH, { each: true })
  @Validate(SafeTreePathConstraint, { each: true })
  path: string[];
}

export class CodeownersErrorDTO {
  @ApiProperty({ example: 4 })
  line: number;

  @ApiProperty({ example: 7 })
  column: number;

  @ApiProperty({ example: 'Unknown owner' })
  kind: string;

  @ApiProperty({
    description: 'The whole line as written.',
    example: 'docs/ @alcie',
  })
  source: string;

  @ApiProperty({ type: String, nullable: true })
  suggestion: string | null;

  @ApiProperty({
    example:
      'Unknown owner on line 4: make sure @alcie exists and has write access to the repository',
  })
  message: string;

  @ApiProperty({ example: '.github/CODEOWNERS' })
  path: string;
}

export class GetCodeownersResponseDTO {
  @ApiProperty({
    description:
      'The CODEOWNERS file in effect, or null when the ref has none or it is over 3 MB.',
    type: String,
    nullable: true,
    example: '.github/CODEOWNERS',
  })
  path: string | null;

  @ApiProperty({ type: [CodeownersErrorDTO] })
  errors: CodeownersErrorDTO[];
}

export class GetCodeownersOwnersResponseDTO {
  @ApiProperty({
    description:
      'Owners with write access of each requested file, keyed by its normalized path. Users read `@login`, teams `@organization/team`.',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
    example: { 'src/main.ts': ['@alice', '@acme/infra'] },
  })
  owners: Record<string, string[]>;
}
