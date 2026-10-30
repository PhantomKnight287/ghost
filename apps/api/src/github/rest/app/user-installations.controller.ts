import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import { AllowUserTokens } from '../../../lib/apps/app-permission.js';
import type { GithubRequest, GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import {
  GithubInstallationRepositoriesDTO,
  GithubUserInstallationsDTO,
} from './dto/installation.dto.js';
import { GithubInstallationsService } from './installations.service.js';

/** What a user-to-server token's user can reach through its app. Only `ghu_` tokens may ask, as on GitHub. */
@AllowUserTokens()
@Controller('v3/user/installations')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@ApiGithubErrors()
export class GithubUserInstallationsController {
  constructor(private readonly installations: GithubInstallationsService) {}

  @Get()
  @ApiOperation({
    summary: "The app's installations the token's user can reach",
  })
  @ApiOkResponse({ type: GithubUserInstallationsDTO })
  list(@Req() req: GithubRequest, @Query() query: GithubPageQueryDTO) {
    return this.installations.ofUserToken(req.userToServer, query);
  }

  @Get(':installation_id/repositories')
  @ApiOperation({
    summary: "An installation's repositories the token's user can see",
  })
  @ApiOkResponse({ type: GithubInstallationRepositoriesDTO })
  repositories(
    @Req() req: GithubRequest,
    @Viewer() viewer: GithubViewer | null,
    @Param('installation_id', ParseIntPipe) installationId: number,
    @Query() query: GithubPageQueryDTO,
  ) {
    return this.installations.repositoriesOfUserToken(
      req.userToServer,
      viewer,
      installationId,
      query,
    );
  }
}
