import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../../../database/database.module.js';
import { orNull } from '../../../../lib/github/authorize.js';
import {
  CouldNotResolveError,
  GithubForbiddenError,
} from '../../../../lib/github/github.errors.js';
import {
  decodeNodeId,
  decodeNodeIdAs,
} from '../../../../lib/github/node-id.js';
import { requireOauthAppAllowed } from '../../../../lib/organizations/oauth-app-access.js';
import { RepositoriesService } from '../../../../resources/repositories/repositories.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { requireWriteScope } from '../../../auth/require-scopes.js';
import { RepositoryVisibility } from '../../enums.js';
import * as M from '../../types/mutations.type.js';
import { RepositoryNodesService } from '../repository/repository-nodes.service.js';

@Injectable()
export class RepositoryMutationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repositories: RepositoriesService,
    private readonly repositoryNodes: RepositoryNodesService,
  ) {}

  async createRepository(
    input: M.CreateRepositoryInput,
    viewer: GithubViewer | null,
  ) {
    if (!viewer)
      throw new GithubForbiddenError(
        'You must be signed in to run CreateRepository.',
      );
    const visibility =
      input.visibility === RepositoryVisibility.PUBLIC ? 'public' : 'private';
    requireWriteScope(viewer, 'createRepository', {
      isPrivate: visibility === 'private',
    });
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
    if (organization && viewer.oauthClientId)
      await requireOauthAppAllowed(this.db, viewer.oauthClientId, organization);
    const created = await this.repositories.createRepository(
      {
        name: input.name,
        description: input.description ?? undefined,
        visibility,
        organization,
      },
      viewer.userId,
    );
    return {
      clientMutationId: input.clientMutationId,
      repository: await this.repositoryNodes.load(created.id, viewer),
    };
  }

  /** Only the name and description: Ghost keeps none of the other settings GitHub's input carries. */
  async updateRepository(
    input: M.UpdateRepositoryInput,
    viewer: GithubViewer | null,
  ) {
    if (!viewer)
      throw new GithubForbiddenError(
        'You must be signed in to run UpdateRepository.',
      );
    const repository = await orNull(
      this.repositoryNodes.load(
        decodeNodeIdAs(input.repositoryId, 'Repository'),
        viewer,
      ),
    );
    if (!repository)
      throw new CouldNotResolveError(
        `Could not resolve to a node with the global id of '${input.repositoryId}'`,
      );
    requireWriteScope(viewer, 'updateRepository', repository);
    const { id } = await this.repositories.updateRepository({
      username: repository.ownerLogin,
      slug: repository.slug,
      requesterId: viewer.userId,
      changes: {
        name: input.name ?? undefined,
        description: input.description ?? undefined,
      },
    });
    return {
      clientMutationId: input.clientMutationId,
      repository: await this.repositoryNodes.load(id, viewer),
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
