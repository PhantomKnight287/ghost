import { Args, Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { ReleaseOrder } from '../../inputs.js';
import { ReleaseConnection, ReleaseNode } from '../../types/release.type.js';
import { RepositoryNode } from '../../types/repository.type.js';
import { ReleaseNodesService } from './release-nodes.service.js';

/** A repository's releases, over ReleasesService. */
@Resolver(() => RepositoryNode)
@AllowAnonymous()
export class RepositoryReleasesResolver {
  constructor(private readonly releaseNodes: ReleaseNodesService) {}

  @ResolveField(() => ReleaseConnection)
  releases(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { nullable: true }) after?: string,
    @Args('orderBy', { type: () => ReleaseOrder, nullable: true })
    orderBy?: ReleaseOrder,
  ) {
    return this.releaseNodes.releases(
      repository,
      viewer,
      first,
      after,
      orderBy,
    );
  }

  @ResolveField(() => ReleaseNode, { nullable: true })
  release(
    @Parent() repository: RepositoryNode,
    @Args('tagName') tagName: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releaseNodes.release(repository, tagName, viewer);
  }
}
