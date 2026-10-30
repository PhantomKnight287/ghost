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

import { GithubSimpleUserDTO } from '../../users/dto/user.dto.js';
import { GithubLabelDTO } from './label.dto.js';

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
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
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
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
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

export const AUTHOR_ASSOCIATION = {
  enum: ['OWNER', 'NONE'],
  description:
    '`OWNER` for the repository owner, `NONE` for everyone else: Ghost does not tell members and collaborators apart here.',
};

export class GithubIssuePullRequestLinksDTO {
  @ApiProperty()
  url: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  diff_url: string;

  @ApiProperty()
  patch_url: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  merged_at: string | null;
}

export class GithubIssueDTO {
  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  repository_url: string;

  @ApiProperty()
  labels_url: string;

  @ApiProperty()
  comments_url: string;

  @ApiProperty()
  events_url: string;

  @ApiProperty()
  timeline_url: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  number: number;

  @ApiProperty({ enum: ['open', 'closed'] })
  state: string;

  @ApiProperty({
    type: String,
    enum: ['completed'],
    nullable: true,
    description:
      'Ghost records no close reason, so every closed issue reads as `completed`.',
  })
  state_reason: 'completed' | null;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  body: string | null;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  user: GithubSimpleUserDTO | null;

  @ApiProperty({ type: [GithubLabelDTO] })
  labels: GithubLabelDTO[];

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  assignee: GithubSimpleUserDTO | null;

  @ApiProperty({ type: [GithubSimpleUserDTO] })
  assignees: GithubSimpleUserDTO[];

  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Always null: Ghost has no milestones on this API.',
  })
  milestone: null;

  @ApiProperty({ example: false })
  locked: boolean;

  @ApiProperty({ type: String, nullable: true })
  active_lock_reason: null;

  @ApiProperty()
  comments: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  closed_at: string | null;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  closed_by: GithubSimpleUserDTO | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty(AUTHOR_ASSOCIATION)
  author_association: string;

  @ApiProperty({
    type: () => GithubViaAppDTO,
    nullable: true,
    description: 'The app a user-to-server token acted through.',
  })
  performed_via_github_app: GithubViaAppDTO | null;

  @ApiPropertyOptional({ description: 'Pull requests only.' })
  draft?: boolean;

  @ApiPropertyOptional({
    type: GithubIssuePullRequestLinksDTO,
    description: 'Pull requests only: what marks the issue as one.',
  })
  pull_request?: GithubIssuePullRequestLinksDTO;
}

export class GithubIssueCommentDTO {
  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  issue_url: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  user: GithubSimpleUserDTO | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty(AUTHOR_ASSOCIATION)
  author_association: string;

  @ApiProperty({
    type: () => GithubViaAppDTO,
    nullable: true,
    description: 'The app a user-to-server token acted through.',
  })
  performed_via_github_app: GithubViaAppDTO | null;
}

/** As much of GitHub's App object as `performed_via_github_app` needs. */
export class GithubViaAppDTO {
  @ApiProperty()
  id: number;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  node_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  html_url: string;
}
