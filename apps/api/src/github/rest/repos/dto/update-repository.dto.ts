import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/** GitHub's update-repository body, as far as Ghost keeps the setting; other fields are dropped. Only `description` takes null: a null visibility would otherwise read as a change to public. */
export class GithubUpdateRepositoryDTO {
  @ApiPropertyOptional({
    description:
      'Renaming also changes the slug, so the old URL stops resolving.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Ignored when `visibility` is given.' })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  private?: boolean;

  @ApiPropertyOptional({ enum: ['public', 'private'] })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @ApiPropertyOptional({
    description:
      'An existing branch, without `refs/heads/`; 404 when there is none.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  default_branch?: string;
}
