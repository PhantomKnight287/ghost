import type { AppPermissions } from '@ghost/permissions';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  ValidateIf,
} from 'class-validator';

import { AppOwnerDTO } from '../../apps/dto/app.dto.js';

const SELECTIONS = ['all', 'selected'] as const;
type RepositorySelection = (typeof SELECTIONS)[number];

export class UpdateInstallationDTO {
  @ApiProperty({ enum: SELECTIONS })
  @IsIn(SELECTIONS)
  repositorySelection: RepositorySelection;

  @ApiPropertyOptional({
    type: [String],
    description:
      "Required, and at least one, when the selection is `selected`. Each must be one of the account's repositories.",
  })
  @ValidateIf(
    (body: UpdateInstallationDTO) => body.repositorySelection === 'selected',
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  repositoryIds?: string[];
}

export class CreateInstallationDTO extends UpdateInstallationDTO {
  @ApiProperty({
    description:
      'Your username, or the slug of an organization you administer.',
  })
  @IsString()
  account: string;
}

export class InstallationAppDTO {
  @ApiProperty()
  appId: number;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  logoUrl: string | null;
}

export class InstallationRepositoryDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'octo/tools' })
  fullName: string;
}

export class InstallationDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({
    description:
      'The id the app passes to `POST /app/installations/{id}/access_tokens`.',
  })
  installationId: number;

  @ApiProperty({ type: InstallationAppDTO })
  app: InstallationAppDTO;

  @ApiProperty({ type: AppOwnerDTO })
  account: AppOwnerDTO;

  @ApiProperty({ enum: SELECTIONS })
  repositorySelection: RepositorySelection;

  @ApiProperty({
    type: [InstallationRepositoryDTO],
    description: 'Empty when the selection is `all`.',
  })
  repositories: InstallationRepositoryDTO[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', enum: ['read', 'write'] },
    description: 'What the account accepted. The installation can do no more.',
  })
  permissions: AppPermissions;

  @ApiProperty({ type: [String] })
  events: string[];

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601.' })
  suspendedAt: string | null;

  @ApiProperty({ description: 'ISO 8601.' })
  createdAt: string;

  @ApiProperty({
    description:
      "Where to send the installer next: the app's setup URL with `installation_id` and `setup_action`, or the installed-apps settings.",
  })
  redirectUrl: string;
}

export class ListInstallationsResponseDTO {
  @ApiProperty({ type: [InstallationDTO] })
  installations: InstallationDTO[];
}

export class ListRepositoryAppsResponseDTO {
  @ApiProperty({ type: [InstallationAppDTO] })
  apps: InstallationAppDTO[];
}
