import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { schema } from '@ghost/db';

import {
  IsGitignoreTemplate,
  IsLicenseTemplate,
} from '../../../lib/repositories/template-fields.js';

export class CreateRepositoryRequestDTO {
  @ApiProperty({})
  @IsString()
  name: string;

  @ApiPropertyOptional({})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description:
      "Slug of the organization to create the repository in; the requester's own account when omitted. Needs admin in the organization.",
  })
  @IsString()
  @IsOptional()
  organization?: string;

  @ApiPropertyOptional({
    enumName: 'RepositoryVisibility',
    enum: schema.repositoryVisiblity.enumValues,
  })
  @IsIn(schema.repositoryVisiblity.enumValues)
  @IsOptional()
  visibility?: (typeof schema.repositoryVisiblity.enumValues)[number];

  @ApiPropertyOptional({
    description:
      'Starts the repository with a commit holding a README of its name and description.',
  })
  @IsOptional()
  @IsBoolean()
  readme?: boolean;

  @ApiPropertyOptional({
    description:
      'A name from `GET /api/repository-templates`, in any case; its `.gitignore` goes in the first commit.',
    example: 'Node',
  })
  @IsGitignoreTemplate()
  gitignoreTemplate?: string;

  @ApiPropertyOptional({
    description:
      'A license key from `GET /api/repository-templates`, in any case; its text, with the owner and year filled in, goes in the first commit as `LICENSE`.',
    example: 'mit',
  })
  @IsLicenseTemplate()
  licenseTemplate?: string;
}

export class CreateRepositoryResponseDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  slug: string;
}
