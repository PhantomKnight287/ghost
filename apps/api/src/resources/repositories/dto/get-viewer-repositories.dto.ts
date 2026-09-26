import { schema } from '@ghost/db';
import { ApiProperty } from '@nestjs/swagger';

import { type Role, roleHierarchy } from '../../../lib/permissions.js';
import {
  RepositorySearchResultDTO,
  SearchRepositoriesResponseDTO,
} from './search-repositories.dto.js';

export class ViewerRepositoryDTO extends RepositorySearchResultDTO {
  @ApiProperty({
    enumName: 'RepositoryVisibility',
    enum: schema.repositoryVisiblity.enumValues,
  })
  visibility: (typeof schema.repositoryVisiblity.enumValues)[number];

  @ApiProperty({ enumName: 'ViewerRole', enum: roleHierarchy })
  viewerRole: Role;
}

export class GetViewerRepositoriesResponseDTO extends SearchRepositoriesResponseDTO {
  @ApiProperty({ type: [ViewerRepositoryDTO] })
  declare repositories: ViewerRepositoryDTO[];
}
