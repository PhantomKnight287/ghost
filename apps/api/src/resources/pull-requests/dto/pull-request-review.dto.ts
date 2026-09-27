import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

type ReviewState = (typeof schema.pullRequestReviewState.enumValues)[number];
type DiffSide = (typeof schema.diffSide.enumValues)[number];

export class ReviewCommentRequestDTO {
  @ApiProperty({ example: 'src/index.ts' })
  @IsString()
  @MinLength(1)
  path: string;

  @ApiProperty({
    enumName: 'DiffSide',
    enum: schema.diffSide.enumValues,
    description:
      '`deletions` is the base side of the diff, `additions` the head side.',
  })
  @IsIn(schema.diffSide.enumValues)
  side: DiffSide;

  @ApiProperty({
    description:
      'Line number on that side of the diff; the last line of a range.',
  })
  @IsInt()
  @Min(1)
  line: number;

  @ApiPropertyOptional({
    enumName: 'DiffSide',
    enum: schema.diffSide.enumValues,
    description: 'Side of the first line of a range. Defaults to `side`.',
  })
  @IsIn(schema.diffSide.enumValues)
  @IsOptional()
  startSide?: DiffSide;

  @ApiPropertyOptional({
    description: 'First line of a range, for a comment on several lines.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  startLine?: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body: string;
}

export class CreateReviewRequestDTO {
  @ApiProperty({
    enumName: 'PullRequestReviewState',
    enum: schema.pullRequestReviewState.enumValues,
    description:
      'Submits your pending review, if you have one, together with any comments given here.',
  })
  @IsIn(schema.pullRequestReviewState.enumValues)
  state: ReviewState;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20000)
  body?: string;

  @ApiPropertyOptional({ type: [ReviewCommentRequestDTO] })
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReviewCommentRequestDTO)
  comments?: ReviewCommentRequestDTO[];
}

export class ReviewCommentBodyDTO {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body: string;
}

export class UpdateReviewRequestDTO {
  @ApiProperty({
    type: String,
    nullable: true,
    description: '`null` clears the summary.',
  })
  @IsString()
  @ValidateIf((_, value) => value !== null)
  @MaxLength(20000)
  body: string | null;
}

export class DismissReviewRequestDTO {
  @ApiProperty({ example: 'Addressed in the latest push' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message: string;
}

export class ReviewReplyDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  body: string;

  @ApiProperty()
  @IsString()
  authorUsername: string;

  @ApiProperty({ type: String, nullable: true, description: 'Avatar URL.' })
  @IsString()
  @IsOptional()
  authorImage: string | null;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;

  @ApiProperty()
  @IsISO8601()
  updatedAt: string;
}

export class ReviewThreadDTO extends ReviewReplyDTO {
  @ApiProperty()
  @IsString()
  path: string;

  @ApiProperty({ enumName: 'DiffSide', enum: schema.diffSide.enumValues })
  @IsIn(schema.diffSide.enumValues)
  side: DiffSide;

  @ApiProperty()
  @IsInt()
  line: number;

  @ApiProperty({
    enumName: 'DiffSide',
    enum: schema.diffSide.enumValues,
    nullable: true,
  })
  @IsIn(schema.diffSide.enumValues)
  @IsOptional()
  startSide: DiffSide | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'First line of a range; null for a single line.',
  })
  @IsInt()
  @IsOptional()
  startLine: number | null;

  @ApiProperty({
    description:
      'Head commit the comment was made on. Once the head moves on, the comment is outdated.',
  })
  @IsString()
  commitSha: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The rows of the diff the comment points at, as a hunk with its own `@@` header, kept as they were when it was written.',
  })
  @IsString()
  @IsOptional()
  diffHunk: string | null;

  @ApiProperty({ type: [ReviewReplyDTO] })
  @ValidateNested({ each: true })
  @Type(() => ReviewReplyDTO)
  replies: ReviewReplyDTO[];
}

export class PullRequestReviewDTO {
  @ApiProperty({ enum: ['review'], example: 'review' })
  @IsIn(['review'])
  kind: 'review';

  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({
    enumName: 'PullRequestReviewState',
    enum: schema.pullRequestReviewState.enumValues,
    nullable: true,
    description: 'Null while the review is pending.',
  })
  @IsIn(schema.pullRequestReviewState.enumValues)
  @IsOptional()
  state: ReviewState | null;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  body: string | null;

  @ApiProperty()
  @IsString()
  authorUsername: string;

  @ApiProperty({ type: String, nullable: true, description: 'Avatar URL.' })
  @IsString()
  @IsOptional()
  authorImage: string | null;

  @ApiProperty({
    description:
      'Head commit when the review was submitted, or started if it is pending.',
  })
  @IsString()
  commitSha: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Null once that account is deleted, even though the review stays dismissed.',
  })
  @IsString()
  @IsOptional()
  dismissedByUsername: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Set once the review is dismissed; a dismissed verdict no longer counts.',
  })
  @IsString()
  @IsOptional()
  dismissalMessage: string | null;

  @ApiProperty({ type: [ReviewThreadDTO] })
  @ValidateNested({ each: true })
  @Type(() => ReviewThreadDTO)
  comments: ReviewThreadDTO[];

  @ApiProperty({
    description: 'When the review was submitted, or started if it is pending.',
  })
  @IsISO8601()
  createdAt: string;
}

export class GetPendingReviewResponseDTO {
  @ApiProperty({
    type: PullRequestReviewDTO,
    nullable: true,
    description: 'Your unsubmitted review, visible to nobody else.',
  })
  @ValidateNested()
  @Type(() => PullRequestReviewDTO)
  @IsOptional()
  review: PullRequestReviewDTO | null;
}

export class ReviewerDTO {
  @ApiProperty()
  @IsString()
  username: string;

  @ApiProperty({ type: String, nullable: true, description: 'Avatar URL.' })
  @IsString()
  @IsOptional()
  image: string | null;

  @ApiProperty({
    enum: ['approved', 'changes_requested'],
    description:
      "The reviewer's latest verdict, unless it was dismissed. Comment-only reviews do not change it.",
  })
  @IsIn(['approved', 'changes_requested'])
  state: 'approved' | 'changes_requested';
}

export class ApplySuggestionResponseDTO {
  @ApiProperty({ description: 'The commit pushed to the head branch.' })
  @IsString()
  commitSha: string;
}
