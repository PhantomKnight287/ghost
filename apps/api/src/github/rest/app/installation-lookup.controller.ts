import { Controller, Get, Param, UseFilters } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubApp } from '../../auth/github-request.js';
import { CallingApp } from '../../auth/viewer.decorator.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubInstallationDTO } from './dto/installation.dto.js';
import { GithubInstallationsService } from './installations.service.js';

/** Which of the app's installations covers a repository or account, for a JWT. */
@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@ApiGithubErrors()
export class GithubInstallationLookupController {
  constructor(private readonly installations: GithubInstallationsService) {}

  @Get('repos/:owner/:repo/installation')
  @ApiOperation({ summary: "The app's installation covering a repository" })
  @ApiOkResponse({ type: GithubInstallationDTO })
  forRepository(
    @CallingApp() app: GithubApp | null,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ) {
    return this.installations.forRepository(app, owner, repo);
  }

  @Get('orgs/:org/installation')
  @ApiOperation({ summary: "The app's installation on an organization" })
  @ApiOkResponse({ type: GithubInstallationDTO })
  forOrganization(
    @CallingApp() app: GithubApp | null,
    @Param('org') org: string,
  ) {
    return this.installations.forOrganization(app, org);
  }

  @Get('users/:username/installation')
  @ApiOperation({ summary: "The app's installation on a user" })
  @ApiOkResponse({ type: GithubInstallationDTO })
  forUser(
    @CallingApp() app: GithubApp | null,
    @Param('username') username: string,
  ) {
    return this.installations.forUser(app, username);
  }
}
