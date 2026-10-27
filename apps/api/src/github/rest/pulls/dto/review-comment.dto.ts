import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { AUTHOR_ASSOCIATION } from '../../issues/dto/issue.dto.js';
import { GithubSimpleUserDTO } from '../../users/dto/user.dto.js';
import { GithubLinkDTO } from './pull.dto.js';

const SIDES = ['LEFT', 'RIGHT'] as const;
type Side = (typeof SIDES)[number];

/** A line comment in GitHub's create-review `comments[]`. The legacy `position` is not supported, so `line` is required. */
export class GithubDraftReviewCommentDTO {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  path: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body: string;

  @ApiProperty({ description: 'The last line of a range.' })
  @IsInt()
  @Min(1)
  line: number;

  @ApiPropertyOptional({ enum: SIDES, default: 'RIGHT' })
  @IsOptional()
  @IsIn(SIDES)
  side?: Side;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  start_line?: number;

  @ApiPropertyOptional({ enum: SIDES, description: 'Defaults to `side`.' })
  @IsOptional()
  @IsIn(SIDES)
  start_side?: Side;
}

/** GitHub's create-review-comment body: a line comment, or with `in_reply_to` a reply, which takes its path and lines from the comment it answers. */
export class GithubCreateReviewCommentDTO {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body: string;

  @ApiPropertyOptional({ description: 'The id of the comment replied to.' })
  @IsOptional()
  @IsInt()
  in_reply_to?: number;

  @ApiPropertyOptional({
    description:
      'Required without `in_reply_to`; a commit of the pull request.',
  })
  @ValidateIf((body) => body.in_reply_to === undefined)
  @IsString()
  commit_id?: string;

  @ApiPropertyOptional({ description: 'Required without `in_reply_to`.' })
  @ValidateIf((body) => body.in_reply_to === undefined)
  @IsString()
  @MinLength(1)
  path?: string;

  @ApiPropertyOptional({
    description: 'Required without `in_reply_to`; the last line of a range.',
  })
  @ValidateIf((body) => body.in_reply_to === undefined)
  @IsInt()
  @Min(1)
  line?: number;

  @ApiPropertyOptional({ enum: SIDES, default: 'RIGHT' })
  @IsOptional()
  @IsIn(SIDES)
  side?: Side;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  start_line?: number;

  @ApiPropertyOptional({ enum: SIDES, description: 'Defaults to `side`.' })
  @IsOptional()
  @IsIn(SIDES)
  start_side?: Side;
}

const EVENTS = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const;
export type ReviewEvent = (typeof EVENTS)[number];

/** GitHub's create-review body. Without `event` the review stays pending until it is submitted. */
export class GithubCreateReviewDTO {
  @ApiPropertyOptional({
    enum: EVENTS,
    description: 'Leave out to start a pending review.',
  })
  @IsOptional()
  @IsIn(EVENTS)
  event?: ReviewEvent;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;

  @ApiPropertyOptional({
    description: 'A commit of the pull request; defaults to its head.',
  })
  @IsOptional()
  @IsString()
  commit_id?: string;

  @ApiPropertyOptional({ type: [GithubDraftReviewCommentDTO] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GithubDraftReviewCommentDTO)
  comments?: GithubDraftReviewCommentDTO[];
}

/** GitHub's submit-review body, which sends a pending review. */
export class GithubSubmitReviewDTO {
  @ApiProperty({ enum: EVENTS })
  @IsIn(EVENTS)
  event: ReviewEvent;

  @ApiPropertyOptional({
    description: "Replaces the pending review's summary when given.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;
}

export class GithubReviewLinksDTO {
  @ApiProperty({ type: GithubLinkDTO })
  html: GithubLinkDTO;

  @ApiProperty({ type: GithubLinkDTO })
  pull_request: GithubLinkDTO;
}

export class GithubReviewDTO {
  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  user: GithubSimpleUserDTO | null;

  @ApiProperty({ description: 'Empty when the review has none.' })
  body: string;

  @ApiProperty({
    enum: [
      'PENDING',
      'COMMENTED',
      'APPROVED',
      'CHANGES_REQUESTED',
      'DISMISSED',
    ],
  })
  state: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  pull_request_url: string;

  @ApiProperty(AUTHOR_ASSOCIATION)
  author_association: string;

  @ApiProperty({ type: GithubReviewLinksDTO })
  _links: GithubReviewLinksDTO;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Null while the review is pending.',
  })
  submitted_at: string | null;

  @ApiProperty({ description: 'The head the review read.' })
  commit_id: string;
}

export class GithubReviewCommentLinksDTO extends GithubReviewLinksDTO {
  @ApiProperty({ type: GithubLinkDTO })
  self: GithubLinkDTO;
}

export class GithubReviewCommentDTO {
  @ApiProperty()
  url: string;

  @ApiProperty()
  pull_request_review_id: number;

  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty({
    description: "Empty when Ghost kept none; a reply shows its thread's.",
  })
  diff_hunk: string;

  @ApiProperty()
  path: string;

  @ApiProperty()
  commit_id: string;

  @ApiProperty({ description: 'The same as `commit_id`.' })
  original_commit_id: string;

  @ApiPropertyOptional({
    description: 'Replies only: the comment that opened the thread.',
  })
  in_reply_to_id?: number;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  user: GithubSimpleUserDTO | null;

  @ApiProperty()
  body: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  pull_request_url: string;

  @ApiProperty(AUTHOR_ASSOCIATION)
  author_association: string;

  @ApiProperty({ type: GithubReviewCommentLinksDTO })
  _links: GithubReviewCommentLinksDTO;

  @ApiProperty({ type: Number, nullable: true })
  start_line: number | null;

  @ApiProperty({ type: Number, nullable: true })
  original_start_line: number | null;

  @ApiProperty({ type: String, enum: ['LEFT', 'RIGHT'], nullable: true })
  start_side: 'LEFT' | 'RIGHT' | null;

  @ApiProperty({ type: Number, nullable: true })
  line: number | null;

  @ApiProperty({ type: Number, nullable: true })
  original_line: number | null;

  @ApiProperty({ enum: SIDES })
  side: Side;

  @ApiProperty({ example: 'line' })
  subject_type: string;
}
