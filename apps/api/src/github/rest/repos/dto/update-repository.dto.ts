import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/** GitHub's update-repository body, as far as Ghost keeps the setting; other fields are dropped. */
export class GithubUpdateRepositoryDTO {
  @ApiPropertyOptional({
    description:
      'Renaming also changes the slug, so the old URL stops resolving.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Ignored when `visibility` is given.' })
  @IsOptional()
  @IsBoolean()
  private?: boolean;

  @ApiPropertyOptional({ enum: ['public', 'private'] })
  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @ApiPropertyOptional({
    description:
      'An existing branch, without `refs/heads/`; 404 when there is none.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  default_branch?: string;
}
