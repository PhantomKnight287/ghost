import { schema } from '@ghost/db';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LabelDTO } from './label.dto.js';

export class IssueDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Per repository, and what the URL carries.',
  })
  @IsInt()
  number: number;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  body: string | null;

  @ApiProperty({
    enumName: 'IssueState',
    enum: schema.issueState.enumValues,
  })
  @IsIn(schema.issueState.enumValues)
  state: (typeof schema.issueState.enumValues)[number];

  @ApiProperty({
    description:
      'True when this number belongs to a pull request; its page lives under `/pulls`.',
  })
  @IsBoolean()
  isPullRequest: boolean;

  @ApiProperty()
  @IsString()
  authorUsername: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  closedByUsername: string | null;

  @ApiProperty({ type: [LabelDTO] })
  @ValidateNested({ each: true })
  @Type(() => LabelDTO)
  labels: LabelDTO[];

  @ApiProperty({ example: ['octocat'] })
  @IsArray()
  assignees: string[];

  @ApiProperty()
  @IsInt()
  commentCount: number;

  @ApiProperty({ type: String, nullable: true })
  @IsISO8601()
  @IsOptional()
  closedAt: string | null;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;

  @ApiProperty()
  @IsISO8601()
  updatedAt: string;

  @ApiProperty({
    description:
      'True when the requesting user is the author or can write to the repository.',
  })
  @IsBoolean()
  viewerCanEdit: boolean;
}

export class IssueDetailDTO extends IssueDTO {}

export const ISSUE_SORTS = ['created', 'updated', 'comments'] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

export class GetIssuesQueryDTO {
  @ApiPropertyOptional({
    enumName: 'IssueStateFilter',
    enum: [...schema.issueState.enumValues, 'all'],
    default: 'open',
  })
  @IsIn([...schema.issueState.enumValues, 'all'])
  @IsOptional()
  state?: (typeof schema.issueState.enumValues)[number] | 'all';

  @ApiPropertyOptional({
    description: 'Full-text search over title and body.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Filter by author username.' })
  @IsString()
  @IsOptional()
  author?: string;

  @ApiPropertyOptional({ description: 'Filter by assignee username.' })
  @IsString()
  @IsOptional()
  assignee?: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated label names. An issue must carry all of them.',
    example: 'bug,help wanted',
  })
  @IsString()
  @IsOptional()
  labels?: string;

  @ApiPropertyOptional({ enum: ISSUE_SORTS, default: 'created' })
  @IsIn(ISSUE_SORTS)
  @IsOptional()
  sort?: IssueSort;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  direction?: 'asc' | 'desc';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  limit?: number;
}

export class GetIssuesResponseDTO {
  @ApiProperty({ type: [IssueDTO] })
  @ValidateNested({ each: true })
  @Type(() => IssueDTO)
  issues: IssueDTO[];

  @ApiProperty({ description: 'Matching every filter except `state`.' })
  @IsInt()
  total: number;

  @ApiProperty()
  @IsInt()
  openCount: number;

  @ApiProperty()
  @IsInt()
  closedCount: number;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  nextCursor: string | null;

  @ApiProperty()
  @IsBoolean()
  hasMore: boolean;
}

export class IssueTimelineEventDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({
    enumName: 'IssueEventType',
    enum: schema.issueEventType.enumValues,
  })
  @IsIn(schema.issueEventType.enumValues)
  type: (typeof schema.issueEventType.enumValues)[number];

  @ApiProperty()
  @IsString()
  actorUsername: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  labelName: string | null;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  assigneeUsername: string | null;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  oldTitle: string | null;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  newTitle: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The commit that closed the issue, or the merge commit of a `merged` event.',
  })
  @IsString()
  @IsOptional()
  commitSha: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'octocat/ghost',
    description: 'Repository of the pull request that closed the issue.',
  })
  @IsString()
  @IsOptional()
  sourceRepository: string | null;

  @ApiProperty({ type: Number, nullable: true })
  @IsInt()
  @IsOptional()
  sourceNumber: number | null;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;
}

export class IssueTimelineCommentDTO {
  @ApiProperty({ enum: ['comment'], example: 'comment' })
  @IsIn(['comment'])
  kind: 'comment';

  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  body: string;

  @ApiProperty()
  @IsString()
  authorUsername: string;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;

  @ApiProperty()
  @IsISO8601()
  updatedAt: string;
}

export class IssueTimelineEventItemDTO {
  @ApiProperty({ enum: ['event'], example: 'event' })
  @IsIn(['event'])
  kind: 'event';

  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ type: IssueTimelineEventDTO })
  @ValidateNested()
  @Type(() => IssueTimelineEventDTO)
  event: IssueTimelineEventDTO;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;
}

export class IssueReferenceRepositoryDTO {
  @ApiProperty({ example: 'octocat' })
  @IsString()
  username: string;

  @ApiProperty({ example: 'ghost' })
  @IsString()
  slug: string;
}

export class IssueReferenceSourceDTO {
  @ApiProperty()
  @IsInt()
  number: number;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({
    enumName: 'IssueState',
    enum: schema.issueState.enumValues,
  })
  @IsIn(schema.issueState.enumValues)
  state: (typeof schema.issueState.enumValues)[number];

  @ApiProperty()
  @IsBoolean()
  isPullRequest: boolean;
}

export class IssueTimelineReferenceDTO {
  @ApiProperty({ enum: ['reference'], example: 'reference' })
  @IsIn(['reference'])
  kind: 'reference';

  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({
    enumName: 'IssueReferenceSourceType',
    enum: schema.issueReferenceSource.enumValues,
  })
  @IsIn(schema.issueReferenceSource.enumValues)
  sourceType: (typeof schema.issueReferenceSource.enumValues)[number];

  @ApiProperty()
  @IsString()
  actorUsername: string;

  @ApiProperty({ type: IssueReferenceRepositoryDTO })
  @ValidateNested()
  @Type(() => IssueReferenceRepositoryDTO)
  repository: IssueReferenceRepositoryDTO;

  @ApiProperty({
    type: IssueReferenceSourceDTO,
    nullable: true,
    description:
      'The issue or pull request the mention was written in; null for a commit.',
  })
  @ValidateNested()
  @Type(() => IssueReferenceSourceDTO)
  @IsOptional()
  source: IssueReferenceSourceDTO | null;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  commitSha: string | null;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;
}

@ApiExtraModels(
  IssueTimelineCommentDTO,
  IssueTimelineEventItemDTO,
  IssueTimelineReferenceDTO,
)
export class GetIssueTimelineResponseDTO {
  @ApiProperty({
    description:
      'Comments, events and mentions from elsewhere interleaved oldest-first, exactly as rendered.',
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(IssueTimelineCommentDTO) },
        { $ref: getSchemaPath(IssueTimelineEventItemDTO) },
        { $ref: getSchemaPath(IssueTimelineReferenceDTO) },
      ],
    },
  })
  timeline: Array<
    | IssueTimelineCommentDTO
    | IssueTimelineEventItemDTO
    | IssueTimelineReferenceDTO
  >;
}
