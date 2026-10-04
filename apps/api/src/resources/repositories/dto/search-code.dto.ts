import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SearchCodeQueryDTO {
  @ApiProperty({
    description:
      'A zoekt query: plain text, `/regex/`, `file:` and `lang:` filters, `case:yes`.',
    example: 'readReceivePackHeader lang:typescript',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  q: string;

  @ApiPropertyOptional({
    description:
      'Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page.',
  })
  @Matches(/^\d{1,5}$/)
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Most files to return.',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class CodeSearchRangeDTO {
  @ApiProperty({ example: 16 })
  @IsNumber()
  start: number;

  @ApiProperty({ example: 37 })
  @IsNumber()
  end: number;
}

export class CodeSearchLineDTO {
  @ApiProperty({ example: 42 })
  @IsNumber()
  lineNumber: number;

  @ApiProperty({
    example: 'export async function readReceivePackHeader(body) {',
  })
  @IsString()
  line: string;

  @ApiProperty({
    type: [CodeSearchRangeDTO],
    description:
      'Matched spans of `line`, as [start, end) offsets that slice a JavaScript string directly.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CodeSearchRangeDTO)
  ranges: CodeSearchRangeDTO[];
}

export class CodeSearchFileDTO {
  @ApiProperty({
    description:
      'The commit the index was built from; line numbers refer to it.',
    example: '9311a72c0e7f4b8a1d2e3f4a5b6c7d8e9f0a1b2c',
  })
  @IsString()
  commit: string;

  @ApiProperty({
    example: 'apps/api/src/lib/git/protocol/receive-pack-request.ts',
  })
  @IsString()
  path: string;

  @ApiProperty({ example: 'TypeScript' })
  @IsString()
  language: string;

  @ApiProperty({
    description:
      'Matches in the file, as far as zoekt counts before its limits. One line can hold several, so this can exceed the ranges in `lines`.',
    example: 3,
  })
  @IsInt()
  matchCount: number;

  @ApiProperty({
    type: [CodeSearchLineDTO],
    description:
      'Up to ten matching lines, each cut at 500 characters with at most twenty ranges. Empty when only the path matched.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CodeSearchLineDTO)
  lines: CodeSearchLineDTO[];
}

export class SearchRepositoryCodeResponseDTO {
  @ApiProperty({
    description:
      'The default branch has commits the index does not cover yet. They are being indexed and show up in results within seconds.',
    example: false,
  })
  @IsBoolean()
  indexing: boolean;

  @ApiProperty({
    type: [CodeSearchFileDTO],
    description: 'Files on the default branch that match, best first.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CodeSearchFileDTO)
  files: CodeSearchFileDTO[];

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  nextCursor: string | null;
}

export class SearchCodeRepositoryDTO {
  @ApiProperty({ example: 'octocat' })
  @IsString()
  owner: string;

  @ApiProperty({ example: 'ghost' })
  @IsString()
  slug: string;

  @ApiProperty({ example: 'ghost' })
  @IsString()
  name: string;
}

export class SearchCodeFileDTO extends CodeSearchFileDTO {
  @ApiProperty({ type: SearchCodeRepositoryDTO })
  @ValidateNested()
  @Type(() => SearchCodeRepositoryDTO)
  repository: SearchCodeRepositoryDTO;
}

export class SearchCodeResponseDTO {
  @ApiProperty({
    type: [SearchCodeFileDTO],
    description:
      'Files in public repositories that match, best first. Only repositories opened since code search was switched on are indexed.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SearchCodeFileDTO)
  files: SearchCodeFileDTO[];

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  nextCursor: string | null;
}
