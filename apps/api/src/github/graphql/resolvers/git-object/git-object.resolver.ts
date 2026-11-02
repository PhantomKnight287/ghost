import {
  Args,
  Context,
  Int,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { RefOrder } from '../../inputs.js';
import {
  GitObject,
  GitSignature,
  TagNode,
} from '../../types/git-object.type.js';
import { CommitNode } from '../../types/pull-request.type.js';
import { ReleaseNode } from '../../types/release.type.js';
import {
  RefConnection,
  RefNode,
  RepositoryNode,
} from '../../types/repository.type.js';
import { GitObjectNodesService } from './git-object-nodes.service.js';

@Resolver(() => RepositoryNode)
@AllowAnonymous()
export class RepositoryRefsResolver {
  constructor(private readonly gitObjects: GitObjectNodesService) {}

  @ResolveField(() => RefNode, { nullable: true })
  ref(
    @Parent() repository: RepositoryNode,
    @Args('qualifiedName') qualifiedName: string,
    @Context() context: GraphqlContext,
  ) {
    return this.gitObjects.ref(repository, qualifiedName, context);
  }

  @ResolveField(() => RefConnection, { nullable: true })
  refs(
    @Parent() repository: RepositoryNode,
    @Context() context: GraphqlContext,
    @Args('refPrefix') refPrefix: string,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
    @Args('query', { type: () => String, nullable: true }) query?: string,
    @Args('orderBy', { type: () => RefOrder, nullable: true })
    orderBy?: RefOrder,
  ) {
    return this.gitObjects.refs(
      repository,
      { refPrefix, first, last, after, query, orderBy },
      context,
    );
  }
}

@Resolver(() => RefNode)
@AllowAnonymous()
export class RefResolver {
  constructor(private readonly gitObjects: GitObjectNodesService) {}

  @ResolveField(() => GitObject, { nullable: true })
  target(@Parent() ref: RefNode, @Context() context: GraphqlContext) {
    return this.gitObjects.refTarget(ref, context);
  }
}

@Resolver(() => TagNode)
@AllowAnonymous()
export class TagResolver {
  constructor(private readonly gitObjects: GitObjectNodesService) {}

  @ResolveField(() => GitObject)
  target(@Parent() tag: TagNode, @Context() context: GraphqlContext) {
    return this.gitObjects.tagTarget(tag, context);
  }

  @ResolveField(() => RepositoryNode)
  repository(@Parent() tag: TagNode, @Context() context: GraphqlContext) {
    return this.gitObjects.repository(tag.repositoryGhostId, context);
  }
}

@Resolver(() => CommitNode)
@AllowAnonymous()
export class CommitGitObjectResolver {
  constructor(private readonly gitObjects: GitObjectNodesService) {}

  @ResolveField(() => GitSignature, { nullable: true })
  signature(@Parent() commit: CommitNode, @Context() context: GraphqlContext) {
    return this.gitObjects.signature(commit, context);
  }

  @ResolveField(() => RepositoryNode)
  repository(@Parent() commit: CommitNode, @Context() context: GraphqlContext) {
    return this.gitObjects.repository(commit.repositoryGhostId, context);
  }
}

@Resolver(() => ReleaseNode)
@AllowAnonymous()
export class ReleaseTagResolver {
  constructor(private readonly gitObjects: GitObjectNodesService) {}

  @ResolveField(() => RefNode, { nullable: true })
  tag(@Parent() release: ReleaseNode, @Context() context: GraphqlContext) {
    return this.gitObjects.ref(
      release.repository,
      `refs/tags/${release.tagName}`,
      context,
    );
  }

  @ResolveField(() => CommitNode, { nullable: true })
  async tagCommit(
    @Parent() release: ReleaseNode,
    @Context() context: GraphqlContext,
  ) {
    const ref = await this.tag(release, context);
    return ref && this.gitObjects.refCommit(ref, context);
  }
}
