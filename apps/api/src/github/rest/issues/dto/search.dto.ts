import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsIn, IsOptional, IsString } from 'class-validator';

import { GithubIssueDTO } from './issue.dto.js';

const SORTS = [
  'comments',
  'reactions',
  'reactions-+1',
  'reactions--1',
  'reactions-smile',
  'reactions-thinking_face',
  'reactions-heart',
  'reactions-tada',
  'interactions',
  'created',
  'updated',
] as const;

/** GitHub's issue search query. Sorts Ghost cannot apply fall back to newest first, as does GitHub's best match. */
export class GithubSearchIssuesQueryDTO {
  @ApiProperty({
    description:
      'GitHub issue search syntax: words, and qualifiers such as `repo:`, `user:`, `org:`, `is:pr`, `label:` and `author:`.',
  })
  @IsString()
  q: string;

  @ApiPropertyOptional({ enum: SORTS })
  @IsOptional()
  @IsIn(SORTS)
  sort?: (typeof SORTS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1 })
  @Allow()
  page?: string;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @Allow()
  per_page?: string;
}

export class GithubSearchIssuesDTO {
  @ApiProperty()
  total_count: number;

  @ApiProperty({
    description: 'Always false: Ghost never cuts a search short.',
  })
  incomplete_results: boolean;

  @ApiProperty({ type: [GithubIssueDTO] })
  items: GithubIssueDTO[];
}
