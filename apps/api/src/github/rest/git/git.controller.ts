import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { UnprocessableError } from '../../../lib/github/github.errors.js';
import { TagNotFoundError } from '../../../lib/releases/releases.errors.js';
import { BranchNotFoundError } from '../../../lib/repositories/repositories.errors.js';
import { RepositoryBranchesService } from '../../../resources/branches/repository-branches.service.js';
import { ReleasesService } from '../../../resources/releases/releases.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubIssuesService } from '../issues/issues.service.js';

@Controller('v3/repos/:owner/:repo/git/refs')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class GithubGitController {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly branches: RepositoryBranchesService,
    private readonly releases: ReleasesService,
  ) {}

  /** `heads/<branch>` or `tags/<tag>`, with Ghost's rules for deleting a branch. */
  @Delete('*ref')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a branch or a tag' })
  async delete(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('ref') ref: string[],
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/git/refs/:ref',
    );
    const target = {
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
    };
    // gh escapes the slash after the namespace, which arrives decoded within one segment.
    const [namespace, ...rest] = ref.join('/').split('/');
    const name = rest.join('/');
    try {
      if (namespace === 'heads' && name)
        return await this.branches.deleteBranch({ ...target, branch: name });
      if (namespace === 'tags' && name)
        return await this.releases.deleteTag({ ...target, tagName: name });
    } catch (error) {
      if (
        !(error instanceof BranchNotFoundError) &&
        !(error instanceof TagNotFoundError)
      )
        throw error;
    }
    throw new UnprocessableError('Reference does not exist');
  }
}
