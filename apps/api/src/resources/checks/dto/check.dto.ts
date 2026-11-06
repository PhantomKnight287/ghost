import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  CHECK_ANNOTATION_LEVELS,
  CHECK_CONCLUSIONS,
  CHECK_STATUSES,
  type CheckConclusion,
  type CheckStatus,
} from '../../../lib/checks/checks.js';

export type CheckAnnotationLevel = (typeof CHECK_ANNOTATION_LEVELS)[number];

export class CheckAppDTO {
  @ApiProperty({ description: 'The App ID, as `integration_id` names it.' })
  appId: number;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  logoUrl: string | null;

  @ApiProperty({
    description: 'The app was deleted; its checks stay attributed to it.',
  })
  deleted: boolean;
}

export class CheckRunOutputDTO {
  @ApiProperty({ type: String, nullable: true })
  title: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Markdown.' })
  summary: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Markdown.' })
  text: string | null;

  @ApiProperty()
  annotationsCount: number;
}

export class CheckRunActionDTO {
  @ApiProperty()
  label: string;

  @ApiProperty()
  description: string;

  @ApiProperty({
    description: 'Sent back to the app when the button is pressed.',
  })
  identifier: string;
}

export class CheckRunDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  suiteId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  headSha: string;

  @ApiProperty({ enum: CHECK_STATUSES })
  status: CheckStatus;

  @ApiProperty({ enum: CHECK_CONCLUSIONS, nullable: true })
  conclusion: CheckConclusion | null;

  @ApiProperty({ type: String, nullable: true })
  startedAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  completedAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  externalId: string | null;

  @ApiProperty({ type: String, nullable: true })
  detailsUrl: string | null;

  @ApiProperty({ type: CheckRunOutputDTO })
  output: CheckRunOutputDTO;

  @ApiProperty({ type: [CheckRunActionDTO] })
  actions: CheckRunActionDTO[];

  @ApiProperty({ type: CheckAppDTO })
  app: CheckAppDTO;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class CheckSuiteDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  headSha: string;

  @ApiProperty({ type: String, nullable: true })
  headBranch: string | null;

  @ApiProperty({ enum: CHECK_STATUSES })
  status: CheckStatus;

  @ApiProperty({ enum: CHECK_CONCLUSIONS, nullable: true })
  conclusion: CheckConclusion | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The tip before the push that created the suite.',
  })
  before: string | null;

  @ApiProperty({ type: String, nullable: true })
  after: string | null;

  @ApiProperty({ type: CheckAppDTO })
  app: CheckAppDTO;

  @ApiProperty()
  runsCount: number;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class CheckAnnotationDTO {
  @ApiProperty()
  path: string;

  @ApiProperty()
  startLine: number;

  @ApiProperty()
  endLine: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  startColumn: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  endColumn: number | null;

  @ApiProperty({ enum: CHECK_ANNOTATION_LEVELS })
  annotationLevel: CheckAnnotationLevel;

  @ApiProperty()
  message: string;

  @ApiProperty({ type: String, nullable: true })
  title: string | null;

  @ApiProperty({ type: String, nullable: true })
  rawDetails: string | null;
}

/** What creating or updating a run takes; the GitHub layer validates GitHub's body and passes this. */
export type CheckRunInput = {
  name?: string;
  headSha?: string;
  detailsUrl?: string;
  externalId?: string;
  status?: CheckStatus;
  conclusion?: CheckConclusion;
  startedAt?: Date;
  completedAt?: Date;
  output?: {
    title: string;
    summary: string;
    text?: string;
    annotations?: CheckAnnotationInput[];
  };
  actions?: CheckRunActionDTO[];
};

export type CheckAnnotationInput = {
  path: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  annotationLevel: CheckAnnotationLevel;
  message: string;
  title?: string;
  rawDetails?: string;
};
