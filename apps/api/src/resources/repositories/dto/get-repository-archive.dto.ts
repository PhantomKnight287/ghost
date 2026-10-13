import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

import {
  ARCHIVE_FORMATS,
  type ArchiveFormat,
} from '../../../lib/git/archive/archive.js';

export class GetRepositoryArchiveQueryDTO {
  @ApiProperty({ enum: ARCHIVE_FORMATS, example: 'zip' })
  @IsIn(ARCHIVE_FORMATS)
  format: ArchiveFormat;

  @ApiPropertyOptional({
    description:
      'Branch, tag or commit sha to archive. Accepts `main`, `refs/heads/main`, `v1.0.0` or a commit sha. Omit for the default branch.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  ref?: string;
}
