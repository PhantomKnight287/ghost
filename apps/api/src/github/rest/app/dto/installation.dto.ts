import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

import { GithubRepositoryDTO } from '../../repos/dto/repository.dto.js';
import { GithubSimpleUserDTO } from '../../users/dto/user.dto.js';

const permissionsProperty = {
  type: 'object' as const,
  additionalProperties: { type: 'string' as const, enum: ['read', 'write'] },
  example: { metadata: 'read', issues: 'write' },
};

/** GitHub's installation object. */
export class GithubInstallationDTO {
  @ApiProperty({ description: 'The id `access_tokens` takes.' })
  id: number;

  @ApiProperty({ type: GithubSimpleUserDTO })
  account: GithubSimpleUserDTO;

  @ApiProperty({ enum: ['all', 'selected'] })
  repository_selection: 'all' | 'selected';

  @ApiProperty()
  access_tokens_url: string;

  @ApiProperty()
  repositories_url: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  app_id: number;

  @ApiProperty()
  app_slug: string;

  @ApiProperty()
  target_id: number;

  @ApiProperty({ enum: ['User', 'Organization'] })
  target_type: 'User' | 'Organization';

  @ApiProperty(permissionsProperty)
  permissions: Record<string, 'read' | 'write'>;

  @ApiProperty({ type: [String] })
  events: string[];

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  single_file_name: null;

  @ApiProperty({ type: String, nullable: true })
  suspended_at: string | null;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  suspended_by: GithubSimpleUserDTO | null;
}

export class GithubCreateInstallationTokenDTO {
  @ApiPropertyOptional({
    ...permissionsProperty,
    description:
      "Lowers the installation's permissions for this token; never raises them.",
  })
  @IsOptional()
  @IsObject()
  permissions?: Record<string, string>;

  @ApiPropertyOptional({
    type: [String],
    description: "Repository names, each one the installation's.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositories?: string[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  repository_ids?: number[];
}

export class GithubInstallationTokenDTO {
  @ApiProperty({ example: 'ghs_16C7e42F292c6912E7710c838347Ae178B4a' })
  token: string;

  @ApiProperty({ description: 'One hour after minting.' })
  expires_at: string;

  @ApiProperty(permissionsProperty)
  permissions: Record<string, 'read' | 'write'>;

  @ApiProperty({ enum: ['all', 'selected'] })
  repository_selection: 'all' | 'selected';
}

export class GithubInstallationRepositoriesDTO {
  @ApiProperty()
  total_count: number;

  @ApiProperty({ enum: ['all', 'selected'] })
  repository_selection: 'all' | 'selected';

  @ApiProperty({ type: [GithubRepositoryDTO] })
  repositories: GithubRepositoryDTO[];
}
