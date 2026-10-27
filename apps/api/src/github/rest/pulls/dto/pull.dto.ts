import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { AUTHOR_ASSOCIATION } from '../../issues/dto/issue.dto.js';
import { GithubLabelDTO } from '../../issues/dto/label.dto.js';
import { GithubRepositoryDTO } from '../../repos/dto/repository.dto.js';
import { GithubSimpleUserDTO } from '../../users/dto/user.dto.js';

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

/** GitHub's requested-reviewers body: logins and team slugs. */
export class GithubRequestedReviewersDTO {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reviewers?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  team_reviewers?: string[];
}

export class GithubLinkDTO {
  @ApiProperty()
  href: string;
}

export class GithubPullBranchDTO {
  @ApiProperty({ example: 'octocat:feature' })
  label: string;

  @ApiProperty({ example: 'feature' })
  ref: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for a base the repository no longer resolves.',
  })
  sha: string | null;

  @ApiProperty({
    type: GithubSimpleUserDTO,
    nullable: true,
    description:
      "The repository's owner; null for an organization or a deleted fork.",
  })
  user: GithubSimpleUserDTO | null;

  @ApiProperty({
    type: GithubRepositoryDTO,
    nullable: true,
    description:
      'Null once the head fork is deleted or the viewer cannot read it.',
  })
  repo: GithubRepositoryDTO | null;
}

export class GithubTeamDTO {
  @ApiProperty()
  node_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ type: String, nullable: true })
  description: null;

  @ApiProperty({ example: 'closed' })
  privacy: string;

  @ApiProperty({ example: 'pull' })
  permission: string;

  @ApiProperty({ type: Object, nullable: true })
  parent: null;
}

export class GithubPullLinksDTO {
  @ApiProperty({ type: GithubLinkDTO })
  self: GithubLinkDTO;

  @ApiProperty({ type: GithubLinkDTO })
  html: GithubLinkDTO;

  @ApiProperty({ type: GithubLinkDTO })
  issue: GithubLinkDTO;

  @ApiProperty({ type: GithubLinkDTO })
  comments: GithubLinkDTO;

  @ApiProperty({ type: GithubLinkDTO })
  review_comments: GithubLinkDTO;

  @ApiProperty({ type: GithubLinkDTO })
  review_comment: GithubLinkDTO;

  @ApiProperty({ type: GithubLinkDTO })
  commits: GithubLinkDTO;

  @ApiProperty({ type: GithubLinkDTO })
  statuses: GithubLinkDTO;
}

const SINGLE =
  'Only on a single pull request: `GET`, `PATCH`, create and reviewer changes, not the list.';

export class GithubPullDTO {
  @ApiProperty()
  url: string;

  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  diff_url: string;

  @ApiProperty()
  patch_url: string;

  @ApiProperty()
  issue_url: string;

  @ApiProperty()
  commits_url: string;

  @ApiProperty()
  review_comments_url: string;

  @ApiProperty()
  review_comment_url: string;

  @ApiProperty()
  comments_url: string;

  @ApiProperty()
  statuses_url: string;

  @ApiProperty()
  number: number;

  @ApiProperty({
    enum: ['open', 'closed'],
    description: 'A merged pull request reads as `closed`; see `merged_at`.',
  })
  state: string;

  @ApiProperty({ example: false })
  locked: boolean;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  user: GithubSimpleUserDTO | null;

  @ApiProperty({ type: String, nullable: true })
  body: string | null;

  @ApiProperty({ type: [GithubLabelDTO] })
  labels: GithubLabelDTO[];

  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Always null: Ghost has no milestones on this API.',
  })
  milestone: null;

  @ApiProperty({ type: String, nullable: true })
  active_lock_reason: null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  closed_at: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  merged_at: string | null;

  @ApiProperty({ type: String, nullable: true })
  merge_commit_sha: string | null;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  assignee: GithubSimpleUserDTO | null;

  @ApiProperty({ type: [GithubSimpleUserDTO] })
  assignees: GithubSimpleUserDTO[];

  @ApiProperty({ type: [GithubSimpleUserDTO] })
  requested_reviewers: GithubSimpleUserDTO[];

  @ApiProperty({
    type: [GithubTeamDTO],
    description: 'Teams carry no integer `id`.',
  })
  requested_teams: GithubTeamDTO[];

  @ApiProperty({ type: GithubPullBranchDTO })
  head: GithubPullBranchDTO;

  @ApiProperty({ type: GithubPullBranchDTO })
  base: GithubPullBranchDTO;

  @ApiProperty({ type: GithubPullLinksDTO })
  _links: GithubPullLinksDTO;

  @ApiProperty(AUTHOR_ASSOCIATION)
  author_association: string;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Always null: Ghost has no auto-merge.',
  })
  auto_merge: null;

  @ApiProperty()
  draft: boolean;

  @ApiPropertyOptional({ description: SINGLE })
  merged?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: `${SINGLE} Null while Ghost has not worked it out.`,
  })
  mergeable?: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: `${SINGLE} The same as \`mergeable\`.`,
  })
  rebaseable?: boolean | null;

  @ApiPropertyOptional({
    enum: [
      'draft',
      'dirty',
      'behind',
      'blocked',
      'unstable',
      'clean',
      'unknown',
    ],
    description: SINGLE,
  })
  mergeable_state?: string;

  @ApiPropertyOptional({
    type: GithubSimpleUserDTO,
    nullable: true,
    description: SINGLE,
  })
  merged_by?: GithubSimpleUserDTO | null;

  @ApiPropertyOptional({ description: SINGLE })
  comments?: number;

  @ApiPropertyOptional({ description: SINGLE })
  review_comments?: number;

  @ApiPropertyOptional({ description: SINGLE })
  maintainer_can_modify?: boolean;

  @ApiPropertyOptional({ description: SINGLE })
  commits?: number;

  @ApiPropertyOptional({ description: SINGLE })
  additions?: number;

  @ApiPropertyOptional({ description: SINGLE })
  deletions?: number;

  @ApiPropertyOptional({ description: SINGLE })
  changed_files?: number;
}

export class GithubRequestedReviewersResponseDTO {
  @ApiProperty({ type: [GithubSimpleUserDTO] })
  users: GithubSimpleUserDTO[];

  @ApiProperty({ type: [GithubTeamDTO] })
  teams: GithubTeamDTO[];
}

export class GithubGitActorDTO {
  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ format: 'date-time' })
  date: string;
}

export class GithubCommitVerificationDTO {
  @ApiProperty()
  verified: boolean;

  @ApiProperty({ enum: ['valid', 'unknown_key', 'unsigned'] })
  reason: string;

  @ApiProperty({ type: String, nullable: true })
  signature: null;

  @ApiProperty({ type: String, nullable: true })
  payload: null;

  @ApiProperty({ type: String, nullable: true })
  verified_at: null;
}

export class GithubGitCommitDTO {
  @ApiProperty({ type: GithubGitActorDTO })
  author: GithubGitActorDTO;

  @ApiProperty({ type: GithubGitActorDTO })
  committer: GithubGitActorDTO;

  @ApiProperty()
  message: string;

  @ApiProperty()
  url: string;

  @ApiProperty({ example: 0 })
  comment_count: number;

  @ApiProperty({ type: GithubCommitVerificationDTO })
  verification: GithubCommitVerificationDTO;
}

export class GithubPullCommitDTO {
  @ApiProperty()
  sha: string;

  @ApiProperty()
  node_id: string;

  @ApiProperty({ type: GithubGitCommitDTO })
  commit: GithubGitCommitDTO;

  @ApiProperty()
  url: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  comments_url: string;

  @ApiProperty({
    type: GithubSimpleUserDTO,
    nullable: true,
    description:
      'The account whose verified email the commit was authored with.',
  })
  author: GithubSimpleUserDTO | null;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  committer: GithubSimpleUserDTO | null;
}

export class GithubPullFileDTO {
  @ApiProperty()
  filename: string;

  @ApiProperty({ enum: ['added', 'removed', 'modified', 'changed'] })
  status: string;

  @ApiProperty()
  additions: number;

  @ApiProperty()
  deletions: number;

  @ApiProperty()
  changes: number;

  @ApiProperty()
  blob_url: string;

  @ApiProperty()
  raw_url: string;
}

export class GithubMergeResultDTO {
  @ApiProperty()
  sha: string;

  @ApiProperty({ example: true })
  merged: boolean;

  @ApiProperty({ example: 'Pull Request successfully merged' })
  message: string;
}
