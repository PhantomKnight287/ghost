import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const asString = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value;

/** GitHub's issue list query; `milestone`, `mentioned`, `type` and `issue_field_values` are dropped by the whitelist, as GitHub ignores filters it cannot apply. */
export class GithubListIssuesQueryDTO {
  @ApiPropertyOptional({ enum: ['open', 'closed', 'all'], default: 'open' })
  @IsOptional()
  @IsIn(['open', 'closed', 'all'])
  state?: 'open' | 'closed' | 'all';

  @ApiPropertyOptional({ description: 'Comma-separated label names.' })
  @IsOptional()
  @IsString()
  labels?: string;

  @ApiPropertyOptional({ description: 'A login, `none` or `*`.' })
  @IsOptional()
  @IsString()
  assignee?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  creator?: string;

  @ApiPropertyOptional({
    enum: ['created', 'updated', 'comments'],
    default: 'created',
  })
  @IsOptional()
  @IsIn(['created', 'updated', 'comments'])
  sort?: 'created' | 'updated' | 'comments';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Only issues updated at or after.' })
  @IsOptional()
  @IsISO8601()
  since?: string;

  @ApiPropertyOptional({ default: 1 })
  @Allow()
  page?: string;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @Allow()
  per_page?: string;
}

/** GitHub's comment list query, for one issue or the whole repository. */
export class GithubListCommentsQueryDTO {
  @ApiPropertyOptional({
    enum: ['created', 'updated'],
    description: 'Repository-wide list only.',
  })
  @IsOptional()
  @IsIn(['created', 'updated'])
  sort?: 'created' | 'updated';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Repository-wide list only; ignored without `sort`.',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Only comments updated at or after.' })
  @IsOptional()
  @IsISO8601()
  since?: string;

  @ApiPropertyOptional({ default: 1 })
  @Allow()
  page?: string;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @Allow()
  per_page?: string;
}

/** GitHub's `page` and `per_page` alone, for lists with no filters. */
export class GithubPageQueryDTO {
  @ApiPropertyOptional({ default: 1 })
  @Allow()
  page?: string;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @Allow()
  per_page?: string;
}

/** GitHub's create-issue body. `milestone`, `type` and the rest are accepted; a milestone other than null is refused, as Ghost has none. */
export class GithubCreateIssueDTO {
  @ApiProperty({ description: 'A string, or a number GitHub turns into one.' })
  @Transform(asString)
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  title: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  body?: string | null;

  @ApiPropertyOptional({ description: 'Deprecated; use `assignees`.' })
  @IsOptional()
  @IsString()
  assignee?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assignees?: string[];

  @ApiPropertyOptional({
    description: 'Names, or objects with a `name`; missing labels are created.',
  })
  @Allow()
  labels?: unknown;

  @ApiPropertyOptional({ description: 'Only `null` is accepted.' })
  @Allow()
  milestone?: unknown;
}

export class GithubUpdateIssueDTO {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asString)
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  body?: string | null;

  @ApiPropertyOptional({ enum: ['open', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'closed'])
  state?: 'open' | 'closed';

  @ApiPropertyOptional({
    enum: ['completed', 'not_planned', 'duplicate', 'reopened'],
    description: 'Accepted and not stored: Ghost records no close reason.',
  })
  @IsOptional()
  @IsIn(['completed', 'not_planned', 'duplicate', 'reopened'])
  state_reason?: string | null;

  @ApiPropertyOptional({ description: 'Deprecated; use `assignees`.' })
  @IsOptional()
  @IsString()
  assignee?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assignees?: string[];

  @ApiPropertyOptional({
    description:
      'Replaces the set. Names, or objects with a `name`; missing labels are created.',
  })
  @Allow()
  labels?: unknown;

  @ApiPropertyOptional({ description: 'Only `null` is accepted.' })
  @Allow()
  milestone?: unknown;
}

export class GithubAssigneesDTO {
  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  assignees: string[];
}

export class GithubCommentDTO {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  body: string;
}
