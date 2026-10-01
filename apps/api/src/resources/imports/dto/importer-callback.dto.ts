import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// GitHub logins, and apps acting as `name[bot]`.
const GITHUB_LOGIN = /^[A-Za-z0-9-]+(\[bot\])?$/;

// The importer cuts batches well below the body limit; this only bounds a single request's transaction.
const MAX_BATCH = 500;

export class ImportAttemptDTO {
  @IsUUID()
  attempt: string;
}

export class ImportedReleaseDTO {
  @IsString()
  tagName: string;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  name: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  body: string | null;

  @IsBoolean()
  isDraft: boolean;

  @IsBoolean()
  isPrerelease: boolean;

  @IsISO8601()
  createdAt: string;

  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  publishedAt: string | null;
}

export class ImportReleasesRequestDTO extends ImportAttemptDTO {
  @ValidateNested({ each: true })
  @ArrayMaxSize(MAX_BATCH)
  @Type(() => ImportedReleaseDTO)
  releases: ImportedReleaseDTO[];
}

export class ImportedLabelDTO {
  @IsString()
  name: string;

  @Matches(/^[0-9a-f]{6}$/)
  color: string;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  description: string | null;
}

export class ImportedPullRequestDTO {
  @IsIn(['open', 'closed', 'merged'])
  state: 'open' | 'closed' | 'merged';

  @IsBoolean()
  draft: boolean;

  @IsString()
  baseRef: string;

  @IsString()
  headRef: string;

  @Matches(/^[0-9a-f]{40}$/)
  headSha: string;

  /** The head branch is in this repository and was pushed with it; false for a fork's branch or a deleted one. */
  @IsBoolean()
  headInRepository: boolean;

  /** Null when GitHub has none, or the importer could not find it in the pushed history. */
  @ValidateIf((_, value) => value !== null)
  @Matches(/^[0-9a-f]{40}$/)
  mergeCommitSha: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  mergedAt: string | null;
}

export class ImportedIssueDTO {
  @IsInt()
  @Min(1)
  number: number;

  @IsString()
  title: string;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  body: string | null;

  @Matches(GITHUB_LOGIN)
  authorLogin: string;

  @IsIn(['open', 'closed'])
  state: 'open' | 'closed';

  @IsISO8601()
  createdAt: string;

  @IsISO8601()
  updatedAt: string;

  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  closedAt: string | null;

  @ValidateNested({ each: true })
  @Type(() => ImportedLabelDTO)
  labels: ImportedLabelDTO[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ImportedPullRequestDTO)
  pullRequest?: ImportedPullRequestDTO;
}

export class ImportIssuesRequestDTO extends ImportAttemptDTO {
  @ValidateNested({ each: true })
  @ArrayMaxSize(MAX_BATCH)
  @Type(() => ImportedIssueDTO)
  issues: ImportedIssueDTO[];
}

export class ImportedCommentDTO {
  @IsInt()
  @Min(1)
  issueNumber: number;

  @Matches(GITHUB_LOGIN)
  authorLogin: string;

  @IsString()
  body: string;

  @IsISO8601()
  createdAt: string;

  @IsISO8601()
  updatedAt: string;
}

export class ImportCommentsRequestDTO extends ImportAttemptDTO {
  @ValidateNested({ each: true })
  @ArrayMaxSize(MAX_BATCH)
  @Type(() => ImportedCommentDTO)
  comments: ImportedCommentDTO[];
}

export class FinishImportRequestDTO extends ImportAttemptDTO {
  @IsBoolean()
  succeeded: boolean;

  @IsOptional()
  @IsString()
  defaultBranch?: string;

  @ValidateIf((dto: FinishImportRequestDTO) => !dto.succeeded)
  @IsString()
  error?: string;

  @ValidateIf((dto: FinishImportRequestDTO) => !dto.succeeded)
  @IsBoolean()
  retryable?: boolean;
}
