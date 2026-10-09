import { type Database, schema } from '@ghost/db';
import { Inject } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../../../database/database.module.js';
import {
  CouldNotResolveError,
  GithubForbiddenError,
} from '../../../../lib/github/github.errors.js';
import { decodeNodeId } from '../../../../lib/github/node-id.js';
import { RepositoriesService } from '../../../../resources/repositories/repositories.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { RepositoryVisibility } from '../../enums.js';
import * as M from '../../types/mutations.type.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';

@Resolver()
@AllowAnonymous()
export class RepositoryMutationsResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repositories: RepositoriesService,
    private readonly repositoryNodes: RepositoryResolver,
  ) {}

  @Mutation(() => M.CreateRepositoryPayload, { nullable: true })
  async createRepository(
    @Args('input') input: M.CreateRepositoryInput,
    @Viewer() viewer: GithubViewer | null,
  ) {
    if (!viewer)
      throw new GithubForbiddenError(
        'You must be signed in to run CreateRepository.',
      );
    const owner = input.ownerId ? decodeNodeId(input.ownerId) : null;
    if (
      input.ownerId &&
      owner?.type !== 'User' &&
      owner?.type !== 'Organization'
    )
      throw new CouldNotResolveError(
        `Could not resolve to a node with the global id of '${input.ownerId}'`,
      );
    if (owner?.type === 'User' && owner.id !== viewer.userId)
      throw new GithubForbiddenError(
        'You can only create repositories for yourself or an organization you administer.',
      );
    const organization =
      owner?.type === 'Organization'
        ? await this.organizationSlug(owner.id)
        : undefined;
    const created = await this.repositories.createRepository(
      {
        name: input.name,
        description: input.description ?? undefined,
        visibility:
          input.visibility === RepositoryVisibility.PUBLIC
            ? 'public'
            : 'private',
        organization,
      },
      viewer.userId,
    );
    return {
      clientMutationId: input.clientMutationId,
      repository: await this.repositoryNodes.load(created.id, viewer.userId),
    };
  }

  private async organizationSlug(organizationId: string) {
    const [row] = await this.db
      .select({ slug: schema.organization.slug })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId));
    if (!row)
      throw new CouldNotResolveError('Could not resolve to an Organization.');
    return row.slug;
  }
}
