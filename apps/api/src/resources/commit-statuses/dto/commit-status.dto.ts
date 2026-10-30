import { ViaAppDTO } from '../../apps/dto/via-app.dto.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  COMMIT_STATUS_STATES,
  type CommitStatusState,
  DEFAULT_STATUS_CONTEXT,
  MAX_STATUS_DESCRIPTION,
} from '../../../lib/commit-statuses/commit-statuses.js';

export class CreateCommitStatusRequestDTO {
  @ApiProperty({ enum: COMMIT_STATUS_STATES })
  @IsIn(COMMIT_STATUS_STATES)
  state: CommitStatusState;

  @ApiPropertyOptional({
    description: 'Where the result can be seen, such as the CI build page.',
    example: 'https://ci.example.com/builds/42',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  targetUrl?: string;

  @ApiPropertyOptional({ maxLength: MAX_STATUS_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STATUS_DESCRIPTION)
  description?: string;

  @ApiPropertyOptional({
    description: 'Tells one reporter apart from another on the same commit.',
    default: DEFAULT_STATUS_CONTEXT,
    example: 'ci/build',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  context?: string;
}

export class CommitStatusCreatorDTO {
  @ApiProperty()
  @IsString()
  username: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  image: string | null;
}

export class CommitStatusDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ enum: COMMIT_STATUS_STATES })
  @IsIn(COMMIT_STATUS_STATES)
  state: CommitStatusState;

  @ApiProperty({ example: 'ci/build' })
  @IsString()
  context: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  description: string | null;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  targetUrl: string | null;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;

  @ApiProperty({
    type: CommitStatusCreatorDTO,
    nullable: true,
    description: 'Null once the creator account is deleted.',
  })
  @ValidateNested()
  @Type(() => CommitStatusCreatorDTO)
  @IsOptional()
  creator: CommitStatusCreatorDTO | null;

  @ApiProperty({
    type: () => ViaAppDTO,
    nullable: true,
    description:
      'The app a user-to-server token acted through, shown as "via".',
  })
  viaApp: ViaAppDTO | null;
}

export class CombinedCommitStatusDTO {
  @ApiProperty()
  @IsString()
  sha: string;

  @ApiProperty({
    enum: COMMIT_STATUS_STATES,
    description:
      '`failure` when any context failed or errored, else `pending` while any is pending or there are none, else `success`.',
  })
  @IsIn(COMMIT_STATUS_STATES)
  state: CommitStatusState;

  @ApiProperty({ description: 'Number of contexts.' })
  @IsInt()
  totalCount: number;

  @ApiProperty({
    type: [CommitStatusDTO],
    description: 'The newest status of each context.',
  })
  @ValidateNested({ each: true })
  @Type(() => CommitStatusDTO)
  statuses: CommitStatusDTO[];
}

export class StatusContextsDTO {
  @ApiProperty({
    type: [String],
    description:
      "Contexts this repository's statuses have named, most recently posted first, at most 50.",
  })
  contexts: string[];
}
