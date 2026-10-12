import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';

import { DATABASE } from '../../../../database/database.module.js';
import {
  authorizeOrNotFound,
  orNull,
} from '../../../../lib/github/authorize.js';
import { CouldNotResolveError } from '../../../../lib/github/github.errors.js';
import type { Loaders } from '../../../../lib/github/loaders.js';
import { encodeNodeId } from '../../../../lib/github/node-id.js';
import {
  toIssueNode,
  toLabelNode,
  toOrganizationNode,
  toRepositoryNode,
  toUserNode,
  type UserRow,
} from '../../../../lib/github/nodes.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import { hasScope } from '../../../../lib/github/scopes.js';
import { oauthAppBlocked } from '../../../../lib/organizations/oauth-app-access.js';
import type { AuthorizedRepository } from '../../../../lib/repositories/access/repository-access.js';
import { ownerNameOf } from '../../../../lib/repositories/access/repository-access.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import { RepositoryAccessService } from '../../../../services/git/repository-access/repository-access.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { issueCursor, sliceConnection } from '../../connection.js';
import {
  IssueOrderField,
  IssueState,
  LabelOrderField,
  OrderDirection,
  PullRequestState,
} from '../../enums.js';
import { IssueFilters, IssueOrder, LabelOrder } from '../../inputs.js';
import { PullRequestNode } from '../../types/pull-request.type.js';
import { RepositoryNode } from '../../types/repository.type.js';
import { IssueNodesService } from '../issue/issue-nodes.service.js';

@Injectable()
export class RepositoryNodesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly config: ConfigService,
    private readonly issuesService: IssuesService,
    private readonly issueNodes: IssueNodesService,
  ) {}

  async repository(owner: string, name: string, viewer: GithubViewer | null) {
    const row = await authorizeOrNotFound(this.access, {
      owner,
      name,
      requesterId: viewer?.userId,
    });
    await this.refuseUnreachable(
      row,
      viewer,
      `Could not resolve to a Repository with the name '${owner}/${name}'.`,
    );
    return this.toNode(row.id, row);
  }

  /** RepositoryOwner.repository(name:): a repository the viewer cannot read answers null, as on GitHub. */
  ownedRepository(login: string, name: string, viewer: GithubViewer | null) {
    return this.repository(login, name, viewer).catch((error: unknown) => {
      if (error instanceof CouldNotResolveError) return null;
      throw error;
    });
  }

  /** The node for a repository already authorized, for other resolvers (issue.repository, node(id:)). */
  async load(repositoryId: string, viewer: GithubViewer | null) {
    const row = await this.access.authorizeById({
      repositoryId,
      requesterId: viewer?.userId,
    });
    await this.refuseUnreachable(
      row,
      viewer,
      `Could not resolve to a node with the global id of '${encodeNodeId('Repository', repositoryId)}'`,
    );
    return this.toNode(repositoryId, row);
  }

  /** What the viewer may read, the token can still miss: a token without `repo` cannot see private repositories at all, and an OAuth app an organization has not approved cannot see the organization's repositories. Both read as missing, not forbidden, as on GitHub. */
  private async refuseUnreachable(
    row: AuthorizedRepository,
    viewer: GithubViewer | null,
    message: string,
  ) {
    if (!viewer) return;
    if (
      (row.visibility === 'private' && !hasScope(viewer.scopes, 'repo')) ||
      (viewer.oauthClientId &&
        row.organizationId &&
        (await oauthAppBlocked(this.db, {
          clientId: viewer.oauthClientId,
          organizationId: row.organizationId,
        })))
    )
      throw new CouldNotResolveError(message);
  }

  async owner(repository: RepositoryNode, loaders: Loaders) {
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

  async parent(repository: RepositoryNode, viewer: GithubViewer | null) {
    if (!repository.parentGhostId) return null;
    // A parent the viewer cannot read reads as no parent, as on GitHub.
    return orNull(this.load(repository.parentGhostId, viewer));
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

  async labels(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    first?: number,
    after?: string,
    query?: string,
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

  async label(
    repository: RepositoryNode,
    name: string,
    viewer: GithubViewer | null,
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

  async assignableUsers(
    repository: RepositoryNode,
    loaders: Loaders,
    first?: number,
    after?: string,
    query?: string,
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

  async issues(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    first?: number,
    after?: string,
    states?: IssueState[],
    labels?: string[],
    orderBy?: IssueOrder,
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

  async issue(
    repository: RepositoryNode,
    number: number,
    viewer: GithubViewer | null,
  ) {
    const found = await this.issueNodes
      .fromRepository(repository, number, viewer)
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

  async pullRequests(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    first?: number,
    after?: string,
    states?: PullRequestState[],
    labels?: string[],
    headRefName?: string,
    baseRefName?: string,
    orderBy?: IssueOrder,
  ) {
    const sort =
      orderBy?.field === IssueOrderField.UPDATED_AT ? 'updated' : 'created';
    const page = await this.issuesService.getIssues(
      {
        username: repository.ownerLogin,
        repo: repository.slug,
        requesterId: viewer?.userId,
        query: {
          state: 'all',
          sort,
          direction: orderBy?.direction === OrderDirection.ASC ? 'asc' : 'desc',
          cursor: after,
          // The controller's ValidationPipe caps limit at 100; GraphQL arguments skip it.
          limit: Math.min(first ?? 30, 100),
          labels: labels?.join(','),
        },
      },
      {
        pullRequests: {
          states: states?.map(
            (state) => state.toLowerCase() as Lowercase<PullRequestState>,
          ),
          headRef: headRefName,
          baseRef: baseRefName,
        },
      },
    );
    const nodes = await this.issueNodes.toNodes(page.issues, repository);
    return {
      nodes,
      edges: nodes.map((node, index) => ({
        node,
        cursor: issueCursor(page.issues[index]!, sort),
      })),
      totalCount: page.total,
      pageInfo: {
        hasNextPage: page.hasMore,
        hasPreviousPage: !!after,
        startCursor: null,
        endCursor: page.nextCursor,
      },
    };
  }

  async pullRequest(
    repository: RepositoryNode,
    number: number,
    viewer: GithubViewer | null,
  ) {
    const found = await orNull(
      this.issueNodes.fromRepository(repository, number, viewer),
    );
    if (!(found instanceof PullRequestNode))
      throw new CouldNotResolveError(
        `Could not resolve to a PullRequest with the number of ${number}.`,
      );
    return found;
  }

  issueOrPullRequest(
    repository: RepositoryNode,
    number: number,
    viewer: GithubViewer | null,
  ) {
    return this.issueNodes.fromRepository(repository, number, viewer);
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
