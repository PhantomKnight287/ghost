import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import {
  COMMIT_STATUS_STATES,
  type CommitStatusState,
  DEFAULT_STATUS_CONTEXT,
  MAX_STATUS_DESCRIPTION,
} from '../../../../lib/commit-statuses/commit-statuses.js';

import { GithubRepositoryDTO } from '../../repos/dto/repository.dto.js';
import { GithubSimpleUserDTO } from '../../users/dto/user.dto.js';

/** GitHub's create-status body. */
export class GithubCreateStatusDTO {
  @ApiProperty({ enum: COMMIT_STATUS_STATES })
  @IsIn(COMMIT_STATUS_STATES)
  state: CommitStatusState;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl({ require_protocol: true })
  target_url?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MAX_STATUS_DESCRIPTION,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_STATUS_DESCRIPTION)
  description?: string | null;

  @ApiPropertyOptional({ default: DEFAULT_STATUS_CONTEXT })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  context?: string;
}

export class GithubStatusDTO {
  @ApiProperty()
  url: string;

  @ApiProperty({
    description: "The creator's avatar; empty when there is none.",
  })
  avatar_url: string;

  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty({ enum: COMMIT_STATUS_STATES })
  state: CommitStatusState;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: String, nullable: true })
  target_url: string | null;

  @ApiProperty({ example: DEFAULT_STATUS_CONTEXT })
  context: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({
    format: 'date-time',
    description: 'The same as `created_at`: each report is a new status.',
  })
  updated_at: string;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  creator: GithubSimpleUserDTO | null;
}

export class GithubCombinedStatusDTO {
  @ApiProperty({
    enum: COMMIT_STATUS_STATES,
    description: 'The worst state among the latest status of each context.',
  })
  state: CommitStatusState;

  @ApiProperty({
    type: [GithubStatusDTO],
    description: 'The latest status of each context.',
  })
  statuses: GithubStatusDTO[];

  @ApiProperty()
  sha: string;

  @ApiProperty()
  total_count: number;

  @ApiProperty({ type: GithubRepositoryDTO })
  repository: GithubRepositoryDTO;

  @ApiProperty()
  commit_url: string;

  @ApiProperty()
  url: string;
}
