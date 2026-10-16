import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
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
  context?: string;
}
