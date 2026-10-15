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
