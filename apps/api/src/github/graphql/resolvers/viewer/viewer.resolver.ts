import { Args, Context, ID, Query, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { type GraphqlContext } from '../../../../lib/github/loaders.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { Node, RepositoryOwner } from '../../types/node.interface.js';
import { OrganizationNode } from '../../types/organization.type.js';
import { UserNode } from '../../types/user.type.js';
import { ViewerService } from './viewer.service.js';

@Resolver()
@AllowAnonymous()
export class ViewerResolver {
  constructor(private readonly viewers: ViewerService) {}

  @Query(() => UserNode, { description: 'The currently authenticated user.' })
  viewer(
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
  ) {
    return this.viewers.viewer(viewer, loaders);
  }

  @Query(() => UserNode, { nullable: true })
  user(@Args('login') login: string, @Context() { loaders }: GraphqlContext) {
    return this.viewers.user(login, loaders);
  }

  @Query(() => OrganizationNode, { nullable: true })
  organization(@Args('login') login: string) {
    return this.viewers.organization(login);
  }

  @Query(() => RepositoryOwner, { nullable: true })
  repositoryOwner(
    @Args('login') login: string,
    @Context() context: GraphqlContext,
  ) {
    return this.viewers.repositoryOwner(login, context.loaders);
  }

  @Query(() => Node, { nullable: true })
  node(
    @Args('id', { type: () => ID }) id: string,
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
  ) {
    return this.viewers.node(id, viewer, loaders);
  }

  @Query(() => [Node], { nullable: 'items' })
  nodes(
    @Args('ids', { type: () => [ID] }) ids: string[],
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
  ) {
    return this.viewers.nodes(ids, viewer, loaders);
  }
}
