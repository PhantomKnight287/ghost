import { Controller, Get, UseFilters } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { MetaService } from './meta.service.js';
import { GithubMetaDTO } from './dto/meta.dto.js';
import { ApiGithubErrors } from '../dto/error.dto.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@ApiGithubErrors()
export class MetaController {
  constructor(private readonly metadata: MetaService) {}

  @Get()
  @ApiOperation({
    summary: 'GitHub API root; gh reads the X-OAuth-Scopes header it carries',
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  root() {
    return this.metadata.root();
  }

  @Get('meta')
  @ApiOperation({
    summary:
      'GitHub Enterprise meta; installed_version decides which search syntax gh uses',
  })
  @ApiOkResponse({ type: GithubMetaDTO })
  meta() {
    return this.metadata.meta();
  }
}
