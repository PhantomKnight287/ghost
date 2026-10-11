import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** GitHub's pull request list query; `popularity` and `long-running` sort as `created`. */
export class GithubListPullsQueryDTO {
  @ApiPropertyOptional({ enum: ['open', 'closed', 'all'], default: 'open' })
  @IsOptional()
  @IsIn(['open', 'closed', 'all'])
  state?: 'open' | 'closed' | 'all';

  @ApiPropertyOptional({ description: '`owner:branch` or a bare branch.' })
  @IsOptional()
  @IsString()
  head?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  base?: string;

  @ApiPropertyOptional({
    enum: ['created', 'updated', 'popularity', 'long-running'],
    default: 'created',
  })
  @IsOptional()
  @IsIn(['created', 'updated', 'popularity', 'long-running'])
  sort?: 'created' | 'updated' | 'popularity' | 'long-running';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1 })
  @Allow()
  page?: string;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @Allow()
  per_page?: string;
}

/** GitHub's create-pull-request body. Opening a pull request from an existing issue (`issue`) is not supported, so it is dropped by the whitelist. */
export class GithubCreatePullDTO {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({ description: 'A branch, or `owner:branch` for a fork.' })
  @IsString()
  head: string;

  @ApiPropertyOptional({ description: 'The fork the head branch is on.' })
  @IsOptional()
  @IsString()
  head_repo?: string;

  @ApiProperty()
  @IsString()
  base: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  @ApiPropertyOptional({ description: 'Accepted and ignored.' })
  @IsOptional()
  @IsBoolean()
  maintainer_can_modify?: boolean;
}

export class GithubUpdatePullDTO {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;

  @ApiPropertyOptional({ enum: ['open', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'closed'])
  state?: 'open' | 'closed';

  @ApiPropertyOptional({
    description: 'Only the current base: Ghost cannot retarget a request.',
  })
  @IsOptional()
  @IsString()
  base?: string;

  @ApiPropertyOptional({ description: 'Accepted and ignored.' })
  @IsOptional()
  @IsBoolean()
  maintainer_can_modify?: boolean;
}

export class GithubMergePullDTO {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  commit_title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(65536)
  commit_message?: string;

  @ApiPropertyOptional({
    description: 'The head the merge must still be at.',
  })
  @IsOptional()
  @IsString()
  sha?: string;

  @ApiPropertyOptional({
    enum: ['merge', 'squash', 'rebase'],
    default: 'merge',
  })
  @IsOptional()
  @IsIn(['merge', 'squash', 'rebase'])
  merge_method?: 'merge' | 'squash' | 'rebase';
}
