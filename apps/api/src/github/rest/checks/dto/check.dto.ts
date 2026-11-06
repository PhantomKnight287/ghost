import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Allow,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  CHECK_ANNOTATION_LEVELS,
  CHECK_CONCLUSIONS,
  CHECK_STATUSES,
  type CheckConclusion,
  type CheckStatus,
  MAX_ACTION_DESCRIPTION,
  MAX_ACTION_IDENTIFIER,
  MAX_ACTION_LABEL,
  MAX_ACTIONS,
  MAX_ANNOTATIONS_PER_REQUEST,
  MAX_CHECK_NAME,
  MAX_OUTPUT_TEXT,
  MAX_OUTPUT_TITLE,
} from '../../../../lib/checks/checks.js';
import type { CheckAnnotationLevel } from '../../../../resources/checks/dto/check.dto.js';
import { GithubAppDTO } from '../../app/dto/app.dto.js';
import { GithubPageQueryDTO } from '../../issues/dto/issue.dto.js';

export class GithubCheckAnnotationInputDTO {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  path: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  start_line: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  end_line: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  start_column?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  end_column?: number;

  @ApiProperty({ enum: CHECK_ANNOTATION_LEVELS })
  @IsIn(CHECK_ANNOTATION_LEVELS)
  annotation_level: CheckAnnotationLevel;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_OUTPUT_TEXT)
  message: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_OUTPUT_TITLE)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_OUTPUT_TEXT)
  raw_details?: string;
}

/** GitHub's `output`. `images` is accepted and dropped: Ghost does not show them. */
export class GithubCheckOutputInputDTO {
  @ApiProperty({ maxLength: MAX_OUTPUT_TITLE })
  @IsString()
  @MaxLength(MAX_OUTPUT_TITLE)
  title: string;

  @ApiProperty({ maxLength: MAX_OUTPUT_TEXT, description: 'Markdown.' })
  @IsString()
  @MaxLength(MAX_OUTPUT_TEXT)
  summary: string;

  @ApiPropertyOptional({ maxLength: MAX_OUTPUT_TEXT, description: 'Markdown.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_OUTPUT_TEXT)
  text?: string;

  @ApiPropertyOptional({
    type: [GithubCheckAnnotationInputDTO],
    maxItems: MAX_ANNOTATIONS_PER_REQUEST,
    description: 'Appended to what earlier requests sent.',
  })
  @IsOptional()
  @ArrayMaxSize(MAX_ANNOTATIONS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => GithubCheckAnnotationInputDTO)
  annotations?: GithubCheckAnnotationInputDTO[];

  @ApiPropertyOptional({ description: 'Accepted and ignored.' })
  @Allow()
  images?: unknown;
}

export class GithubCheckActionInputDTO {
  @ApiProperty({ maxLength: MAX_ACTION_LABEL })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ACTION_LABEL)
  label: string;

  @ApiProperty({ maxLength: MAX_ACTION_DESCRIPTION })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ACTION_DESCRIPTION)
  description: string;

  @ApiProperty({ maxLength: MAX_ACTION_IDENTIFIER })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ACTION_IDENTIFIER)
  identifier: string;
}

/** GitHub's update-check-run body; create adds `name` and `head_sha`. */
export class GithubUpdateCheckRunDTO {
  @ApiPropertyOptional({ maxLength: MAX_CHECK_NAME })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CHECK_NAME)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  details_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  external_id?: string;

  @ApiPropertyOptional({ enum: CHECK_STATUSES })
  @IsOptional()
  @IsIn(CHECK_STATUSES)
  status?: CheckStatus;

  @ApiPropertyOptional({ enum: CHECK_CONCLUSIONS })
  @IsOptional()
  @IsIn(CHECK_CONCLUSIONS)
  conclusion?: CheckConclusion;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  started_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  completed_at?: string;

  @ApiPropertyOptional({ type: GithubCheckOutputInputDTO })
  @IsOptional()
  @ValidateNested()
  @Type(() => GithubCheckOutputInputDTO)
  output?: GithubCheckOutputInputDTO;

  @ApiPropertyOptional({
    type: [GithubCheckActionInputDTO],
    maxItems: MAX_ACTIONS,
  })
  @IsOptional()
  @ArrayMaxSize(MAX_ACTIONS)
  @ValidateNested({ each: true })
  @Type(() => GithubCheckActionInputDTO)
  actions?: GithubCheckActionInputDTO[];
}

export class GithubCreateCheckRunDTO extends GithubUpdateCheckRunDTO {
  @ApiProperty({ maxLength: MAX_CHECK_NAME })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CHECK_NAME)
  declare name: string;

  @ApiProperty()
  @IsString()
  head_sha: string;
}

export class GithubCreateCheckSuiteDTO {
  @ApiProperty()
  @IsString()
  head_sha: string;
}

export class GithubCheckRunsQueryDTO extends GithubPageQueryDTO {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  check_name?: string;

  @ApiPropertyOptional({ enum: CHECK_STATUSES })
  @IsOptional()
  @IsIn(CHECK_STATUSES)
  status?: CheckStatus;

  @ApiPropertyOptional({ enum: ['latest', 'all'], default: 'latest' })
  @IsOptional()
  @IsIn(['latest', 'all'])
  filter?: 'latest' | 'all';

  @ApiPropertyOptional({ description: 'The App ID.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  app_id?: number;
}

export class GithubCheckSuitesQueryDTO extends GithubPageQueryDTO {
  @ApiPropertyOptional({ description: 'The App ID.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  app_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  check_name?: string;
}

export class GithubCheckRunOutputDTO {
  @ApiProperty({ type: String, nullable: true })
  title: string | null;

  @ApiProperty({ type: String, nullable: true })
  summary: string | null;

  @ApiProperty({ type: String, nullable: true })
  text: string | null;

  @ApiProperty()
  annotations_count: number;

  @ApiProperty()
  annotations_url: string;
}

export class GithubCheckRunDTO {
  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty()
  head_sha: string;

  @ApiProperty({ type: String, nullable: true })
  external_id: string | null;

  @ApiProperty()
  url: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty({ type: String, nullable: true })
  details_url: string | null;

  @ApiProperty({ enum: CHECK_STATUSES })
  status: CheckStatus;

  @ApiProperty({ enum: CHECK_CONCLUSIONS, nullable: true })
  conclusion: CheckConclusion | null;

  @ApiProperty({ type: String, nullable: true })
  started_at: string | null;

  @ApiProperty({ type: String, nullable: true })
  completed_at: string | null;

  @ApiProperty({ type: GithubCheckRunOutputDTO })
  output: GithubCheckRunOutputDTO;

  @ApiProperty()
  name: string;

  @ApiProperty()
  check_suite: { id: number };

  @ApiProperty({ type: GithubAppDTO })
  app: GithubAppDTO;

  @ApiProperty({ type: [Object], description: 'Always empty.' })
  pull_requests: never[];
}

export class GithubCheckRunsDTO {
  @ApiProperty()
  total_count: number;

  @ApiProperty({ type: [GithubCheckRunDTO] })
  check_runs: GithubCheckRunDTO[];
}

export class GithubCheckAnnotationDTO {
  @ApiProperty()
  path: string;

  @ApiProperty()
  blob_href: string;

  @ApiProperty()
  start_line: number;

  @ApiProperty()
  end_line: number;

  @ApiProperty({ type: Number, nullable: true })
  start_column: number | null;

  @ApiProperty({ type: Number, nullable: true })
  end_column: number | null;

  @ApiProperty({ enum: CHECK_ANNOTATION_LEVELS })
  annotation_level: CheckAnnotationLevel;

  @ApiProperty({ type: String, nullable: true })
  title: string | null;

  @ApiProperty()
  message: string;

  @ApiProperty({ type: String, nullable: true })
  raw_details: string | null;
}

export class GithubCheckSuiteDTO {
  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty({ type: String, nullable: true })
  head_branch: string | null;

  @ApiProperty()
  head_sha: string;

  @ApiProperty({ enum: CHECK_STATUSES })
  status: CheckStatus;

  @ApiProperty({ enum: CHECK_CONCLUSIONS, nullable: true })
  conclusion: CheckConclusion | null;

  @ApiProperty()
  url: string;

  @ApiProperty({ type: String, nullable: true })
  before: string | null;

  @ApiProperty({ type: String, nullable: true })
  after: string | null;

  @ApiProperty({ type: GithubAppDTO })
  app: GithubAppDTO;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;

  @ApiProperty()
  latest_check_runs_count: number;

  @ApiProperty()
  check_runs_url: string;

  @ApiProperty({ type: [Object], description: 'Always empty.' })
  pull_requests: never[];
}

export class GithubCheckSuitesDTO {
  @ApiProperty()
  total_count: number;

  @ApiProperty({ type: [GithubCheckSuiteDTO] })
  check_suites: GithubCheckSuiteDTO[];
}
