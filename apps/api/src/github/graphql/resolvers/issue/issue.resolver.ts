import { Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Args, Context, Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { CouldNotResolveError } from '../../../../lib/github/github.errors.js';
import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { toIssueCommentNode, toIssueNode, toLabelNode, toPullRequestNode, toUserNode, type UserRow } from '../../../../lib/github/nodes.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import { IssueNotFoundError } from '../../../../lib/issues/issues.errors.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { sliceConnection } from '../../connection.js';
import { IssueCommentConnection } from '../../types/issue-comment.type.js';
import { IssueConnection, IssueNode } from '../../types/issue.type.js';
import type { IssueOrPullRequestFields } from '../../types/issue-or-pull-request.type.js';
import { LabelConnection } from '../../types/label.type.js';
import { Actor } from '../../types/node.interface.js';
import { IssueTypeNode, MilestoneNode, ProjectV2ItemConnection, ProjectV2ItemFieldValue, ProjectV2ItemNode, ReactionGroup, SubIssuesSummary } from '../../types/placeholders.type.js';
import { RepositoryNode } from '../../types/repository.type.js';
import { UserConnection } from '../../types/user.type.js';
// The two resolvers inject each other: the namespace import is read lazily by forwardRef, and the type-only import keeps decorator metadata from touching the class mid-cycle.
import * as repositoryResolver from '../repository/repository.resolver.js';
import type { RepositoryResolver } from '../repository/repository.resolver.js';

@Resolver(() => IssueNode)
@AllowAnonymous()
export class IssueResolver {
  constructor(
    private readonly issues: IssuesService,
    @Inject(forwardRef(() => repositoryResolver.RepositoryResolver)) private readonly repositories: RepositoryResolver,
    private readonly config: ConfigService,
  ) {}

  /** The issue or pull request behind a number, for repository.issue, issueOrPullRequest, node(id:) and the mutations. */
  async fromRepository(repository: RepositoryNode, number: number, requesterId?: string) {
    try {
      const issue = await this.issues.getIssue({ username: repository.ownerLogin, repo: repository.slug, number, requesterId });
      return issue.isPullRequest ? toPullRequestNode(issue, repository) : toIssueNode(issue, repository);
    } catch (error) {
      if (error instanceof IssueNotFoundError) throw new CouldNotResolveError(`Could not resolve to an issue or pull request with the number of ${number}.`);
      throw error;
    }
  }

  @ResolveField(() => Actor, { nullable: true })
  async author(@Parent() issue: IssueOrPullRequestFields, @Context() { loaders }: GraphqlContext) {
    const row = await loaders.usersByLogin.load(issue.authorLogin);
    return row ? toUserNode(row, githubOrigins(this.config)) : null;
  }

  @ResolveField(() => UserConnection)
  async assignees(@Parent() issue: IssueOrPullRequestFields, @Context() { loaders }: GraphqlContext, @Args('first', { type: () => Int, nullable: true }) first?: number) {
    const rows = (await loaders.usersByLogin.loadMany(issue.assigneeLogins)).filter((row): row is UserRow => !!row && !(row instanceof Error));
    return sliceConnection(rows.map((row) => toUserNode(row, githubOrigins(this.config))), { first });
  }

  @ResolveField(() => LabelConnection, { nullable: true })
  labels(@Parent() issue: IssueOrPullRequestFields, @Args('first', { type: () => Int, nullable: true }) first?: number) {
    const repository = { url: issue.repositoryUrl, resourcePath: issue.repositoryResourcePath };
    return sliceConnection(issue.labelDtos.map((label) => toLabelNode(label, repository)), { first });
  }

  @ResolveField(() => IssueCommentConnection)
  async comments(
    @Parent() issue: IssueOrPullRequestFields,
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
  ) {
    const { comments } = await this.issues.getComments({ username: issue.ownerLogin, repo: issue.repoSlug, number: issue.number, requesterId: viewer?.userId });
    const viewerLogin = viewer ? ((await loaders.usersById.load(viewer.userId))?.username ?? null) : null;
    return sliceConnection(comments.map((comment) => toIssueCommentNode(comment, issue, viewerLogin)), { first, last });
  }

  @ResolveField(() => RepositoryNode)
  repository(@Parent() issue: IssueOrPullRequestFields, @Viewer() viewer: GithubViewer | null) {
    return this.repositories.load(issue.repositoryGhostId, viewer?.userId);
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
  projectItems(@Args('first', { type: () => Int, nullable: true }) _first?: number) {
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
  subIssues(@Args('first', { type: () => Int, nullable: true }) _first?: number) {
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
