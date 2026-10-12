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
import { sliceConnection } from '../../connection.js';
import { IssueConnection, IssueNode } from '../../types/issue.type.js';
import { IssueCommentConnection } from '../../types/issue-comment.type.js';
import type { IssueOrPullRequestFields } from '../../types/issue-or-pull-request.type.js';
import { LabelConnection } from '../../types/label.type.js';
import { Actor } from '../../types/node.interface.js';
import {
  IssueTypeNode,
  MilestoneNode,
  ProjectV2ItemConnection,
  ProjectV2ItemFieldValue,
  ProjectV2ItemNode,
  ReactionGroup,
  SubIssuesSummary,
} from '../../types/placeholders.type.js';
import { RepositoryNode } from '../../types/repository.type.js';
import { UserConnection } from '../../types/user.type.js';
import { RepositoryNodesService } from '../repository/repository-nodes.service.js';
import { IssueNodesService } from './issue-nodes.service.js';

@Resolver(() => IssueNode)
@AllowAnonymous()
export class IssueResolver {
  constructor(
    private readonly issues: IssueNodesService,
    private readonly repositories: RepositoryNodesService,
  ) {}

  @ResolveField(() => Int, { nullable: true })
  databaseId(
    @Parent() issue: IssueOrPullRequestFields,
    @Context() { loaders }: GraphqlContext,
  ) {
    return this.issues.databaseId(issue, loaders);
  }

  @ResolveField(() => Actor, { nullable: true })
  author(
    @Parent() issue: IssueOrPullRequestFields,
    @Context() { loaders }: GraphqlContext,
  ) {
    return this.issues.author(issue, loaders);
  }

  @ResolveField(() => UserConnection)
  assignees(
    @Parent() issue: IssueOrPullRequestFields,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ) {
    return this.issues.assignees(issue, loaders, first);
  }

  @ResolveField(() => LabelConnection, { nullable: true })
  labels(
    @Parent() issue: IssueOrPullRequestFields,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ) {
    return this.issues.labels(issue, first);
  }

  @ResolveField(() => IssueCommentConnection)
  comments(
    @Parent() issue: IssueOrPullRequestFields,
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    return this.issues.comments(issue, viewer, loaders, first, last, after);
  }

  @ResolveField(() => RepositoryNode)
  repository(
    @Parent() issue: IssueOrPullRequestFields,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories.load(issue.repositoryGhostId, viewer);
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
    return sliceConnection([], {});
  }

  @ResolveField(() => IssueTypeNode, { nullable: true })
  issueType() {
    return null;
  }

  @ResolveField(() => IssueNode, { nullable: true })
  parent() {
    return null;
  }

  @ResolveField(() => IssueConnection)
  subIssues(
    @Args('first', { type: () => Int, nullable: true }) _first?: number,
  ) {
    return sliceConnection([], {});
  }

  @ResolveField(() => SubIssuesSummary)
  subIssuesSummary() {
    return { total: 0, completed: 0, percentCompleted: 0 };
  }
}

/** ProjectV2Item.fieldValueByName exists so gh's issue view validates; Ghost has no projects, so no item is ever returned. */
@Resolver(() => ProjectV2ItemNode)
@AllowAnonymous()
export class ProjectV2ItemResolver {
  @ResolveField(() => ProjectV2ItemFieldValue, { nullable: true })
  fieldValueByName(@Args('name') _name: string) {
    return null;
  }
}
