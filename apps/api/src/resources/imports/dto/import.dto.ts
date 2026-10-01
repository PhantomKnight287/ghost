import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  ValidateNested,
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  Matches,
} from 'class-validator';
import { schema } from '@ghost/db';

import { CreateRepositoryRequestDTO } from '../../repositories/dto/create-repository.dto.js';

export class StartImportRequestDTO extends CreateRepositoryRequestDTO {
  @ApiProperty({
    description: 'The GitHub repository to import, as `owner/name`.',
    example: 'octocat/hello-world',
  })
  @Matches(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, {
    message: 'source must be a GitHub repository written as owner/name',
  })
  source: string;
}

export class GitHubImportStatusDTO {
  @ApiProperty({
    description: 'Whether this instance can import from GitHub at all.',
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    description:
      'Whether the signed-in user has linked a GitHub account to import with.',
  })
  @IsBoolean()
  connected: boolean;
}

export class RepositoryImportDTO {
  @ApiProperty({
    enumName: 'RepositoryImportStatus',
    enum: schema.repositoryImportStatus.enumValues,
  })
  @IsIn(schema.repositoryImportStatus.enumValues)
  status: (typeof schema.repositoryImportStatus.enumValues)[number];

  @ApiProperty({ example: 'octocat/hello-world' })
  @IsString()
  source: string;

  @ApiProperty({
    description:
      'Attempts made so far; a failed attempt is retried automatically a few times before the import fails.',
  })
  @IsInt()
  attempts: number;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  lastError: string | null;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;

  @ApiProperty()
  @IsISO8601()
  updatedAt: string;
}

export class GitHubRepositoryDTO {
  @ApiProperty({ example: 'octocat/hello-world' })
  @IsString()
  fullName: string;

  @ApiProperty()
  @IsBoolean()
  private: boolean;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  description: string | null;
}

export class GitHubRepositoriesDTO {
  @ApiProperty({ type: [GitHubRepositoryDTO] })
  @ValidateNested({ each: true })
  @Type(() => GitHubRepositoryDTO)
  repositories: GitHubRepositoryDTO[];
}
