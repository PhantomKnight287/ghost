import { type Database, schema } from '@ghost/db';
import { Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { eq, sql } from 'drizzle-orm';
import { RefNode, RepositoryNode } from '../../types/repository.type.js';
import { DATABASE } from '../../../../database/database.module.js';
import { RepositoryAccessService } from '../../../../services/git/repository-access/repository-access.service.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import {
  authorizeOrNotFound,
  orNull,
} from '../../../../lib/github/authorize.js';
import { RepositoryOwner } from '../../types/node.interface.js';
import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import {
  toIssueNode,
  toLabelNode,
  toOrganizationNode,
  toRepositoryNode,
  toUserNode,
  type UserRow,
} from '../../../../lib/github/nodes.js';
import { encodeNodeId } from '../../../../lib/github/node-id.js';
import { ownerNameOf } from '../../../../lib/repositories/access/repository-access.js';
import { UserConnection } from '../../types/user.type.js';
import { LabelConnection, LabelNode } from '../../types/label.type.js';
import { sliceConnection } from '../../connection.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import {
  IssueConnection,
  IssueNode,
  IssueOrPullRequest,
} from '../../types/issue.type.js';
import { PullRequestNode } from '../../types/pull-request.type.js';
import {
  IssueOrderField,
  IssueState,
  LabelOrderField,
  OrderDirection,
} from '../../enums.js';
import { IssueFilters, IssueOrder, LabelOrder } from '../../inputs.js';
import { CouldNotResolveError } from '../../../../lib/github/github.errors.js';
// The two resolvers inject each other: the namespace import is read lazily by forwardRef, and the type-only import keeps decorator metadata from touching the class mid-cycle.
import * as issueResolver from '../issue/issue.resolver.js';
import type { IssueResolver } from '../issue/issue.resolver.js';

@Resolver(() => RepositoryNode)
@AllowAnonymous()
export class RepositoryResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly config: ConfigService,
    private readonly issuesService: IssuesService,
    @Inject(forwardRef(() => issueResolver.IssueResolver))
    private readonly issueNodes: IssueResolver,
  ) {}

  @Query(() => RepositoryNode, { nullable: true })
  async repository(
    @Args('owner') owner: string,
    @Args('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const row = await authorizeOrNotFound(this.access, {
      owner,
      name,
      requesterId: viewer?.userId,
    });
    return this.toNode(row.id, row);
  }

  /** The node for a repository already authorized, for other resolvers (issue.repository, node(id:)). */
  async load(repositoryId: string, requesterId?: string) {
    const row = await this.access.authorizeById({ repositoryId, requesterId });
    return this.toNode(repositoryId, row);
  }

  @ResolveField(() => RepositoryOwner)
  async owner(
    @Parent() repository: RepositoryNode,
    @Context() { loaders }: GraphqlContext,
  ) {
    const origins = githubOrigins(this.config);
    if (repository.organizationGhostId) {
      const [organization] = await this.db
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, repository.organizationGhostId));
      return toOrganizationNode(organization!, origins);
    }
    return toUserNode(
      (await loaders.usersById.load(repository.ownerGhostId))!,
      origins,
    );
  }

  @ResolveField(() => RepositoryNode, { nullable: true })
  async parent(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    if (!repository.parentGhostId) return null;
    // A parent the viewer cannot read reads as no parent, as on GitHub.
    return orNull(this.load(repository.parentGhostId, viewer?.userId));
  }

  @ResolveField(() => RefNode, { nullable: true })
  defaultBranchRef(@Parent() repository: RepositoryNode) {
    const name = repository.defaultBranch ?? 'main';
    return Object.assign(new RefNode(), {
      id: encodeNodeId(
        'Repository',
        `${repository.ghostId}:refs/heads/${name}`,
      ),
      name,
      prefix: 'refs/heads/',
    });
  }

  private async toNode(
    repositoryId: string,
    row: Awaited<ReturnType<RepositoryAccessService['authorize']>>,
  ) {
    const [owner] = await this.db
      .select({ login: ownerNameOf(schema.user, schema.organization) })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(eq(schema.repository.id, repositoryId));
    return toRepositoryNode(row, owner!.login, githubOrigins(this.config));
  }

  @ResolveField(() => LabelConnection, { nullable: true })
  async labels(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
    @Args('query', { nullable: true }) query?: string,
    @Args('orderBy', { type: () => LabelOrder, nullable: true })
    orderBy?: LabelOrder,
  ) {
    // listLabels answers by name, ascending.
    const { labels } = await this.issuesService.listLabels({
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: viewer?.userId,
    });
    const matching = query
      ? labels.filter((label) =>
          label.name.toLowerCase().includes(query.toLowerCase()),
        )
      : labels;
    const ordered =
      orderBy?.field === LabelOrderField.CREATED_AT
        ? matching.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
        : matching;
    const directed =
      orderBy?.direction === OrderDirection.DESC
        ? ordered.toReversed()
        : ordered;
    return sliceConnection(
      directed.map((label) => toLabelNode(label, repository)),
      { first, after },
    );
  }

  @ResolveField(() => LabelNode, { nullable: true })
  async label(
    @Parent() repository: RepositoryNode,
    @Args('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { labels } = await this.issuesService.listLabels({
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: viewer?.userId,
    });
    const label = labels.find(
      (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
    );
    return label ? toLabelNode(label, repository) : null;
  }

  @ResolveField(() => UserConnection)
  async assignableUsers(
    @Parent() repository: RepositoryNode,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
    @Args('query', { nullable: true }) query?: string,
  ) {
    const ids = await this.assignableUserIds(repository.ghostId);
    const rows = (await loaders.usersById.loadMany(ids)).filter(
      (row): row is UserRow => !!row && !(row instanceof Error),
    );
    const matching = query
      ? rows.filter((row) =>
          `${row.username} ${row.name}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
      : rows;
    // Sorted so the offset cursors sliceConnection hands out name the same users on every page.
    const sorted = matching.toSorted((a, b) =>
      (a.username ?? '').localeCompare(b.username ?? ''),
    );
    return sliceConnection(
      sorted.map((row) => toUserNode(row, githubOrigins(this.config))),
      { first, after },
    );
  }

  @ResolveField(() => IssueConnection)
  async issues(
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
    const wanted = new Set(states ?? filterBy?.states ?? []);
    const state =
      wanted.size === 1
        ? wanted.has(IssueState.OPEN)
          ? 'open'
          : 'closed'
        : 'all';
    const sort =
      orderBy?.field === IssueOrderField.UPDATED_AT
        ? 'updated'
        : orderBy?.field === IssueOrderField.COMMENTS
          ? 'comments'
          : 'created';
    const page = await this.issuesService.getIssues({
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: viewer?.userId,
      query: {
        state,
        sort,
        direction: orderBy?.direction === OrderDirection.ASC ? 'asc' : 'desc',
        cursor: after,
        // The controller's ValidationPipe caps limit at 100; GraphQL arguments skip it.
        limit: Math.min(first ?? 30, 100),
        assignee: filterBy?.assignee ?? undefined,
        author: filterBy?.createdBy ?? undefined,
        labels: (labels ?? filterBy?.labels)?.join(','),
      },
    });
    return {
      nodes: page.issues.map((issue) => toIssueNode(issue, repository)),
      totalCount:
        state === 'open'
          ? page.openCount
          : state === 'closed'
            ? page.closedCount
            : page.total,
      pageInfo: {
        hasNextPage: page.hasMore,
        hasPreviousPage: !!after,
        startCursor: null,
        endCursor: page.nextCursor,
      },
    };
  }

  @ResolveField(() => IssueNode, { nullable: true })
  async issue(
    @Parent() repository: RepositoryNode,
    @Args('number', { type: () => Int }) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const found = await this.issueNodes
      .fromRepository(repository, number, viewer?.userId)
      .catch((error: unknown) => {
        if (error instanceof CouldNotResolveError) return null;
        throw error;
      });
    if (!found || found instanceof PullRequestNode)
      throw new CouldNotResolveError(
        `Could not resolve to an Issue with the number of ${number}.`,
      );
    return found;
  }

  @ResolveField(() => IssueOrPullRequest, { nullable: true })
  issueOrPullRequest(
    @Parent() repository: RepositoryNode,
    @Args('number', { type: () => Int }) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issueNodes.fromRepository(repository, number, viewer?.userId);
  }

  /** Who gh offers as assignees: the owner, accepted collaborators and organization members, as the assignee picker's involved set. */
  private async assignableUserIds(repositoryId: string) {
    const rows = await this.db.execute<{ id: string }>(sql`
      select owner_id as id from repository where id = ${repositoryId}
      union select user_id from repository_collaborator where repository_id = ${repositoryId} and accepted_at is not null
      union select m.user_id from member m join repository r on r.organization_id = m.organization_id where r.id = ${repositoryId}
    `);
    return rows.rows.map((row) => row.id);
  }
}

/** RepositoryOwner.repository(name:), inherited by User and Organization; a repository the viewer cannot read answers null, as on GitHub. */
@Resolver(() => RepositoryOwner)
@AllowAnonymous()
export class RepositoryOwnerResolver {
  constructor(private readonly repositories: RepositoryResolver) {}

  @ResolveField(() => RepositoryNode, { nullable: true })
  repository(
    @Parent() owner: { login: string },
    @Args('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repositories
      .repository(owner.login, name, viewer)
      .catch((error: unknown) => {
        if (error instanceof CouldNotResolveError) return null;
        throw error;
      });
  }
}
