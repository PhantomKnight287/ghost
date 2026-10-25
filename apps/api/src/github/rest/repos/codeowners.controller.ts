import { Controller, Get, Param, Query, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubReposService } from './repos.service.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
export class GithubCodeownersController {
  constructor(private readonly repos: GithubReposService) {}

  @Get('repos/:owner/:repo/codeowners/errors')
  @ApiOperation({
    summary:
      'Errors in the CODEOWNERS file at a ref, the default branch when none is given',
  })
  errors(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Query('ref') ref: string | undefined,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.codeownersErrors({ owner, repo, ref, viewer });
  }
}
