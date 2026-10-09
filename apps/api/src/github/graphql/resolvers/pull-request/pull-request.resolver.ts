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
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { IssueCommentConnection } from '../../types/issue-comment.type.js';
import { LabelConnection } from '../../types/label.type.js';
import { Actor } from '../../types/node.interface.js';
import {
  MilestoneNode,
  ProjectV2ItemConnection,
  ReactionGroup,
} from '../../types/placeholders.type.js';
import { PullRequestNode } from '../../types/pull-request.type.js';
import { RepositoryNode } from '../../types/repository.type.js';
import { UserConnection } from '../../types/user.type.js';
import { IssueResolver } from '../issue/issue.resolver.js';

/** The fields a pull request shares with an issue answer exactly as the issue's do. */
@Resolver(() => PullRequestNode)
@AllowAnonymous()
export class PullRequestResolver {
  constructor(private readonly issues: IssueResolver) {}

  @ResolveField(() => Actor, { nullable: true })
  author(@Parent() pull: PullRequestNode, @Context() context: GraphqlContext) {
    return this.issues.author(pull, context);
  }

  @ResolveField(() => UserConnection)
  assignees(
    @Parent() pull: PullRequestNode,
    @Context() context: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ) {
    return this.issues.assignees(pull, context, first);
  }

  @ResolveField(() => LabelConnection, { nullable: true })
  labels(
    @Parent() pull: PullRequestNode,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ) {
    return this.issues.labels(pull, first);
  }

  @ResolveField(() => IssueCommentConnection)
  comments(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.issues.comments(pull, viewer, context, first, last, after);
  }

  @ResolveField(() => RepositoryNode)
  repository(
    @Parent() pull: PullRequestNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.repository(pull, viewer);
  }

  @ResolveField(() => MilestoneNode, { nullable: true })
  milestone() {
    return null;
  }

  @ResolveField(() => [ReactionGroup], { nullable: true })
  reactionGroups() {
    return [];
  }

  @ResolveField(() => ProjectV2ItemConnection)
  projectItems(
    @Args('first', { type: () => Int, nullable: true }) _first?: number,
    @Args('after', { type: () => String, nullable: true }) _after?: string,
    @Args('last', { type: () => Int, nullable: true }) _last?: number,
    @Args('before', { type: () => String, nullable: true }) _before?: string,
    @Args('includeArchived', {
      type: () => Boolean,
      nullable: true,
      defaultValue: true,
    })
    _includeArchived?: boolean,
  ) {
    return this.issues.projectItems();
  }
}
