import { Injectable } from '@nestjs/common';

import { UnprocessableError } from '../../../lib/github/github.errors.js';
import { TagNotFoundError } from '../../../lib/releases/releases.errors.js';
import { BranchNotFoundError } from '../../../lib/repositories/repositories.errors.js';
import { RepositoryBranchesService } from '../../../resources/branches/repository-branches.service.js';
import { ReleasesService } from '../../../resources/releases/releases.service.js';
import type { GithubRepositoryTarget } from '../../auth/github-request.js';
import { GithubIssuesService } from '../issues/issues.service.js';

/** GitHub's git references, over the branch and release services that own them. */
@Injectable()
export class GithubGitService {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly branches: RepositoryBranchesService,
    private readonly releases: ReleasesService,
  ) {}

  /** `heads/<branch>` or `tags/<tag>`, with Ghost's rules for deleting a branch; anything else, or a ref that is not there, does not exist as GitHub words it. */
  async deleteRef(
    { owner, repo, viewer }: GithubRepositoryTarget,
    ref: string,
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
    const [namespace, ...rest] = ref.split('/');
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
