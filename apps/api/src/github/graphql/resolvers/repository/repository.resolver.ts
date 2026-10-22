import {
  Args,
  Context,
  Int,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { toRefNode } from '../../../../lib/github/nodes.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { IssueState, PullRequestState } from '../../enums.js';
import { IssueFilters, IssueOrder, LabelOrder } from '../../inputs.js';
import {
  IssueConnection,
  IssueNode,
  IssueOrPullRequest,
} from '../../types/issue.type.js';
import { LabelConnection, LabelNode } from '../../types/label.type.js';
import { RepositoryOwner } from '../../types/node.interface.js';
import {
  PullRequestConnection,
  PullRequestNode,
} from '../../types/pull-request.type.js';
import { RefNode, RepositoryNode } from '../../types/repository.type.js';
import {
  RepositoryRuleConnection,
  RepositoryRulesetBypassActorConnection,
  RepositoryRulesetConnection,
  RepositoryRulesetNode,
} from '../../types/ruleset.type.js';
import { sliceConnection } from '../../connection.js';
import { UserConnection } from '../../types/user.type.js';
import { RepositoryNodesService } from './repository-nodes.service.js';

@Resolver(() => RepositoryNode)
@AllowAnonymous()
export class RepositoryResolver {
  constructor(private readonly repositories: RepositoryNodesService) {}

  @Query(() => RepositoryNode, { nullable: true })
  repository(
    @Args('owner') owner: string,
    @Args('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.repository(owner, name, viewer);
  }

  @ResolveField(() => RepositoryOwner)
  owner(
    @Parent() repository: RepositoryNode,
    @Context() { loaders }: GraphqlContext,
  ) {
    return this.repositories.owner(repository, loaders);
  }

  @ResolveField(() => RepositoryNode, { nullable: true })
  parent(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.parent(repository, viewer);
  }

  @ResolveField(() => RefNode, { nullable: true })
  defaultBranchRef(@Parent() repository: RepositoryNode) {
    return toRefNode(repository.ghostId, repository.defaultBranch ?? 'main');
  }

  @ResolveField(() => LabelConnection, { nullable: true })
  labels(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
    @Args('query', { nullable: true }) query?: string,
    @Args('orderBy', { type: () => LabelOrder, nullable: true })
    orderBy?: LabelOrder,
  ) {
    return this.repositories.labels(
      repository,
      viewer,
      first,
      after,
      query,
      orderBy,
    );
  }

  @ResolveField(() => LabelNode, { nullable: true })
  label(
    @Parent() repository: RepositoryNode,
    @Args('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.label(repository, name, viewer);
  }

  @ResolveField(() => RepositoryRulesetConnection, { nullable: true })
  rulesets(
    @Parent() repository: RepositoryNode,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.repositories.rulesets(repository, first, after);
  }

  @ResolveField(() => UserConnection)
  assignableUsers(
    @Parent() repository: RepositoryNode,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
    @Args('query', { nullable: true }) query?: string,
  ) {
    return this.repositories.assignableUsers(
      repository,
      loaders,
      first,
      after,
      query,
    );
  }

  @ResolveField(() => IssueConnection)
  issues(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { nullable: true }) after?: string,
    @Args('states', { type: () => [IssueState], nullable: true })
    states?: IssueState[],
    @Args('labels', { type: () => [String], nullable: true }) labels?: string[],
    @Args('orderBy', { type: () => IssueOrder, nullable: true })
    orderBy?: IssueOrder,
    @Args('filterBy', { type: () => IssueFilters, nullable: true })
    filterBy?: IssueFilters,
  ) {
    return this.repositories.issues(
      repository,
      viewer,
      first,
      after,
      states,
      labels,
      orderBy,
      filterBy,
    );
  }

  @ResolveField(() => IssueNode, { nullable: true })
  issue(
    @Parent() repository: RepositoryNode,
    @Args('number', { type: () => Int }) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.issue(repository, number, viewer);
  }

  @ResolveField(() => PullRequestConnection)
  pullRequests(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { nullable: true }) after?: string,
    @Args('states', { type: () => [PullRequestState], nullable: true })
    states?: PullRequestState[],
    @Args('labels', { type: () => [String], nullable: true }) labels?: string[],
    @Args('headRefName', { nullable: true }) headRefName?: string,
    @Args('baseRefName', { nullable: true }) baseRefName?: string,
    @Args('orderBy', { type: () => IssueOrder, nullable: true })
    orderBy?: IssueOrder,
  ) {
    return this.repositories.pullRequests(
      repository,
      viewer,
      first,
      after,
      states,
      labels,
      headRefName,
      baseRefName,
      orderBy,
    );
  }

  @ResolveField(() => PullRequestNode, { nullable: true })
  pullRequest(
    @Parent() repository: RepositoryNode,
    @Args('number', { type: () => Int }) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.pullRequest(repository, number, viewer);
  }

  @ResolveField(() => IssueOrPullRequest, { nullable: true })
  issueOrPullRequest(
    @Parent() repository: RepositoryNode,
    @Args('number', { type: () => Int }) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.issueOrPullRequest(repository, number, viewer);
  }
}

/** RepositoryOwner.repository(name:), inherited by User and Organization; a repository the viewer cannot read answers null, as on GitHub. */
@Resolver(() => RepositoryOwner)
@AllowAnonymous()
export class RepositoryOwnerResolver {
  constructor(private readonly repositories: RepositoryNodesService) {}

  @ResolveField(() => RepositoryNode, { nullable: true })
  repository(
    @Parent() owner: { login: string },
    @Args('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.ownedRepository(owner.login, name, viewer);
  }
}

@Resolver(() => RepositoryRulesetNode)
@AllowAnonymous()
export class RepositoryRulesetResolver {
  @ResolveField(() => RepositoryRuleConnection, { nullable: true })
  rules(
    @Parent() ruleset: RepositoryRulesetNode,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return sliceConnection(ruleset.ruleNodes, { first, after });
  }

  @ResolveField(() => RepositoryRulesetBypassActorConnection, {
    nullable: true,
  })
  bypassActors(
    @Parent() ruleset: RepositoryRulesetNode,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return sliceConnection(ruleset.bypassActorNodes, { first, after });
  }
}
