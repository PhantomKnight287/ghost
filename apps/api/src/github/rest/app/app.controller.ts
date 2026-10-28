import { Controller, Get, UseFilters } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubApp } from '../../auth/github-request.js';
import { CallingApp } from '../../auth/viewer.decorator.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubAppService } from './app.service.js';
import { GithubAppDTO } from './dto/app.dto.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@ApiGithubErrors()
export class GithubAppController {
  constructor(private readonly apps: GithubAppService) {}

  @Get('app')
  @ApiOperation({
    summary: 'The Ghost App a JWT signed by its private key authenticates',
  })
  @ApiOkResponse({ type: GithubAppDTO })
  authenticated(@CallingApp() app: GithubApp | null) {
    return this.apps.authenticated(app);
  }
}
