import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PullRequestSideDTO {
  @ApiProperty({ example: 'bob' })
  @IsString()
  username: string;

  @ApiProperty({ example: 'ghost' })
  @IsString()
  slug: string;

  @ApiProperty({ example: 'main' })
  @IsString()
  ref: string;
}

export class PullRequestDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Per base repository, and what the URL carries.',
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
    enumName: 'PullRequestState',
    enum: schema.pullRequestState.enumValues,
  })
  @IsIn(schema.pullRequestState.enumValues)
  state: (typeof schema.pullRequestState.enumValues)[number];

  @ApiProperty({ type: PullRequestSideDTO })
  @ValidateNested()
  @Type(() => PullRequestSideDTO)
  base: PullRequestSideDTO;

  @ApiProperty({ type: PullRequestSideDTO })
  @ValidateNested()
  @Type(() => PullRequestSideDTO)
  head: PullRequestSideDTO;

  @ApiProperty({ description: 'Head tip as of the last read.' })
  @IsString()
  headSha: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  mergeCommitSha: string | null;

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

export class PullRequestDetailDTO extends PullRequestDTO {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Commit the two branches diverged from.',
  })
  @IsString()
  @IsOptional()
  mergeBase: string | null;

  @ApiProperty({
    description: 'Commits the head branch adds on top of the base.',
  })
  @IsInt()
  commitCount: number;

  @ApiProperty()
  @IsInt()
  changedFiles: number;

  @ApiProperty()
  @IsInt()
  additions: number;

  @ApiProperty()
  @IsInt()
  deletions: number;

  @ApiProperty({
    description: 'Whether the merge is conflict-free right now. Never cached.',
  })
  @IsBoolean()
  mergeable: boolean;
}

export class GetPullRequestsQueryDTO {
  @ApiPropertyOptional({
    enumName: 'PullRequestStateFilter',
    enum: [...schema.pullRequestState.enumValues, 'all'],
    default: 'open',
  })
  @IsIn([...schema.pullRequestState.enumValues, 'all'])
  @IsOptional()
  state?: (typeof schema.pullRequestState.enumValues)[number] | 'all';

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

export class GetPullRequestsResponseDTO {
  @ApiProperty({ type: [PullRequestDTO] })
  @ValidateNested({ each: true })
  @Type(() => PullRequestDTO)
  pullRequests: PullRequestDTO[];

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  nextCursor: string | null;

  @ApiProperty()
  @IsBoolean()
  hasMore: boolean;
}
