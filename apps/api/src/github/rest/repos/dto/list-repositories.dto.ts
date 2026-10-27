import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

import { GithubPageQueryDTO } from '../../issues/dto/issue.dto.js';

const SORTS = ['created', 'updated', 'pushed', 'full_name'] as const;
const DIRECTIONS = ['asc', 'desc'] as const;
const VISIBILITIES = ['all', 'public', 'private'] as const;
const VIEWER_TYPES = ['all', 'owner', 'public', 'private', 'member'] as const;
const USER_TYPES = ['all', 'owner', 'member'] as const;
const ORGANIZATION_TYPES = [
  'all',
  'public',
  'private',
  'forks',
  'sources',
  'member',
] as const;

export type RepositorySort = (typeof SORTS)[number];

/** Sorting and paging every repository list takes. */
export class GithubListRepositoriesQueryDTO extends GithubPageQueryDTO {
  @ApiPropertyOptional({
    enum: SORTS,
    description:
      '`full_name` sorts ignoring case. The default depends on the list.',
  })
  @IsOptional()
  @IsIn(SORTS)
  sort?: RepositorySort;

  @ApiPropertyOptional({
    enum: DIRECTIONS,
    description: '`asc` when sorting by `full_name`, else `desc`.',
  })
  @IsOptional()
  @IsIn(DIRECTIONS)
  direction?: (typeof DIRECTIONS)[number];
}

export class GithubListViewerRepositoriesQueryDTO extends GithubListRepositoriesQueryDTO {
  @ApiPropertyOptional({ enum: VISIBILITIES, default: 'all' })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: (typeof VISIBILITIES)[number];

  @ApiPropertyOptional({
    description:
      'A comma-separated list of `owner`, `collaborator` and `organization_member`. All three by default.',
    example: 'owner,collaborator',
  })
  @IsOptional()
  @Matches(
    /^(owner|collaborator|organization_member)(,(owner|collaborator|organization_member))*$/,
  )
  affiliation?: string;

  @ApiPropertyOptional({
    enum: VIEWER_TYPES,
    default: 'all',
    description: 'Refused with 422 alongside `visibility` or `affiliation`.',
  })
  @IsOptional()
  @IsIn(VIEWER_TYPES)
  type?: (typeof VIEWER_TYPES)[number];
}

export class GithubListUserRepositoriesQueryDTO extends GithubListRepositoriesQueryDTO {
  @ApiPropertyOptional({
    enum: USER_TYPES,
    default: 'owner',
    description:
      '`member` lists the public repositories the user collaborates on.',
  })
  @IsOptional()
  @IsIn(USER_TYPES)
  type?: (typeof USER_TYPES)[number];
}

export class GithubListOrganizationRepositoriesQueryDTO extends GithubListRepositoriesQueryDTO {
  @ApiPropertyOptional({
    enum: ORGANIZATION_TYPES,
    default: 'all',
    description: '`member` keeps the repositories the viewer holds a role on.',
  })
  @IsOptional()
  @IsIn(ORGANIZATION_TYPES)
  type?: (typeof ORGANIZATION_TYPES)[number];
}
