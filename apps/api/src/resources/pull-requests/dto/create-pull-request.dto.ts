import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const REF_PATTERN = /^[^\s~^:?*[\\]+$/;

export class CreatePullRequestRequestDTO {
  @ApiProperty({ example: 'Add a rate limiter' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20000)
  body?: string;

  @ApiProperty({
    description: 'Branch to merge into, in this repository.',
    example: 'main',
  })
  @IsString()
  @Matches(REF_PATTERN)
  base: string;

  @ApiProperty({
    description:
      'Branch to merge from. `owner:branch` for a fork, or a bare branch name for this repository.',
    example: 'alice:feature',
  })
  @IsString()
  @Matches(/^[^\s~^:?*[\\]+(:[^\s~^:?*[\\]+)?$/)
  head: string;
}
