import type { Database } from '@ghost/db';
import { Inject } from '@nestjs/common';
import { Args, Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { DATABASE } from '../../../../database/database.module.js';
import { releaseNumericIdsOf } from '../../../../lib/github/node-lookup.js';
import { toReleaseNode } from '../../../../lib/github/nodes.js';
import { ReleaseNotFoundError } from '../../../../lib/releases/releases.errors.js';
import type { ReleaseDTO } from '../../../../resources/releases/dto/release.dto.js';
import { ReleasesService } from '../../../../resources/releases/releases.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { cursorOffset, offsetCursor } from '../../connection.js';
import { OrderDirection, ReleaseOrderField } from '../../enums.js';
import { ReleaseOrder } from '../../inputs.js';
import { ReleaseConnection, ReleaseNode } from '../../types/release.type.js';
import { RepositoryNode } from '../../types/repository.type.js';

/** A repository's releases, over ReleasesService. */
@Resolver(() => RepositoryNode)
@AllowAnonymous()
export class RepositoryReleasesResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly releaseService: ReleasesService,
  ) {}

  @ResolveField(() => ReleaseConnection)
  async releases(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { nullable: true }) after?: string,
    @Args('orderBy', { type: () => ReleaseOrder, nullable: true })
    orderBy?: ReleaseOrder,
  ) {
    const offset = cursorOffset(after);
    const { releases, total } = await this.releaseService.pageReleases({
      ...this.ref(repository, viewer),
      offset,
      // GraphQL arguments skip the ValidationPipe, so the page size is capped here as GitHub caps it.
      limit: Math.min(Math.max(first ?? 30, 0), 100),
      order: {
        field: orderBy?.field === ReleaseOrderField.NAME ? 'name' : 'created',
        direction: orderBy?.direction === OrderDirection.ASC ? 'asc' : 'desc',
      },
    });
    const end = offset + releases.length;
    return {
      nodes: await this.nodes(repository, releases),
      totalCount: total,
      pageInfo: {
        hasNextPage: end < total,
        hasPreviousPage: offset > 0,
        startCursor: releases.length > 0 ? offsetCursor(offset) : null,
        endCursor: releases.length > 0 ? offsetCursor(end) : null,
      },
    };
  }

  /** Drafts included for those who can write, as on GitHub; this is how gh finds a draft its REST lookup by tag cannot. */
  @ResolveField(() => ReleaseNode, { nullable: true })
  async release(
    @Parent() repository: RepositoryNode,
    @Args('tagName') tagName: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const release = await this.releaseService
      .getReleaseByTag({ ...this.ref(repository, viewer), tagName })
      .catch((error: unknown) => {
        if (error instanceof ReleaseNotFoundError) return null;
        throw error;
      });
    if (!release) return null;
    const [node] = await this.nodes(repository, [release]);
    return node;
  }

  private ref(repository: RepositoryNode, viewer: GithubViewer | null) {
    return {
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: viewer?.userId,
    };
  }

  private async nodes(repository: RepositoryNode, releases: ReleaseDTO[]) {
    const numericIds = await releaseNumericIdsOf(
      this.db,
      releases.map((release) => release.id),
    );
    return releases.map((release) =>
      toReleaseNode(release, numericIds.get(release.id) ?? null, repository),
    );
  }
}
