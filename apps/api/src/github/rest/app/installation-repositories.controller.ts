import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import { GithubInstallationRepositoriesDTO } from './dto/installation.dto.js';
import { GithubInstallationsService } from './installations.service.js';

@Controller('v3/installation/repositories')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@ApiGithubErrors()
export class GithubInstallationRepositoriesController {
  constructor(private readonly installations: GithubInstallationsService) {}

  @Get()
  @ApiOperation({
    summary: 'The repositories an installation token reaches',
  })
  @ApiOkResponse({ type: GithubInstallationRepositoriesDTO })
  list(
    @Viewer() viewer: GithubViewer | null,
    @Query() query: GithubPageQueryDTO,
  ) {
    return this.installations.repositories(viewer, query);
  }
}
