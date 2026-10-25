import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubGitService } from './git.service.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

@Controller('v3/repos/:owner/:repo/git/refs')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
export class GithubGitController {
  constructor(private readonly git: GithubGitService) {}

  /** gh escapes the slash after the namespace, which arrives decoded within one segment, so the segments are joined back. */
  @Delete('*ref')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a branch or a tag' })
  delete(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('ref') ref: string[],
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.git.deleteRef({ owner, repo, viewer }, ref.join('/'));
  }
}
