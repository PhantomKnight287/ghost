import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
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

export class UpdatePullRequestRequestDTO {
  @ApiPropertyOptional({ example: 'Add a rate limiter' })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Markdown. `null` clears the description.',
  })
  @IsString()
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @MaxLength(20000)
  body?: string | null;
}
