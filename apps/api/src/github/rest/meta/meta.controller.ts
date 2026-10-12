import { Controller, Get, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { GithubRestFilter } from '../github-rest.filter.js';
import { MetaService } from './meta.service.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class MetaController {
  constructor(private readonly metadata: MetaService) {}

  @Get()
  @ApiOperation({
    summary: 'GitHub API root; gh reads the X-OAuth-Scopes header it carries',
  })
  root() {
    return this.metadata.root();
  }

  @Get('meta')
  @ApiOperation({
    summary:
      'GitHub Enterprise meta; installed_version decides which search syntax gh uses',
  })
  meta() {
    return this.metadata.meta();
  }
}
