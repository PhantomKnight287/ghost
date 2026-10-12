import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import * as M from '../../types/mutations.type.js';
import { RepositoryMutationsService } from './repository-mutations.service.js';

@Resolver()
@AllowAnonymous()
export class RepositoryMutationsResolver {
  constructor(private readonly mutations: RepositoryMutationsService) {}

  @Mutation(() => M.CreateRepositoryPayload, { nullable: true })
  createRepository(
    @Args('input') input: M.CreateRepositoryInput,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.mutations.createRepository(input, viewer);
  }
}
