import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';

import { DATABASE } from '../../../../database/database.module.js';
import { sameName } from '../../../../lib/db/sql.js';
import { parseIssueSearch } from '../../../../lib/github/issue-search.js';
import { perRepository } from '../../../../lib/github/per-repository.js';
import type { Loaders } from '../../../../lib/github/loaders.js';
import { tokenReaches } from '../../../../lib/github/token-reach.js';
import { organizationTeams } from '../../../../lib/organizations/team-slug.js';
import { ownerNameOf } from '../../../../lib/repositories/access/repository-access.js';
import type { GetIssuesQueryDTO } from '../../../../resources/issues/dto/issue.dto.js';
import {
  type IssueListOptions,
  IssuesService,
} from '../../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { issueCursor } from '../../connection.js';
import { SearchType } from '../../enums.js';
import type { RepositoryNode } from '../../types/repository.type.js';
import { IssueNodesService } from '../issue/issue-nodes.service.js';
import { RepositoryNodesService } from '../repository/repository-nodes.service.js';

const EMPTY = {
  issueCount: 0,
  nodes: [],
  edges: [],
  pageInfo: {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  },
};

/** How a search pages and orders: GraphQL by cursor, REST by offset. */
export type IssueSearchPaging = Pick<
  GetIssuesQueryDTO,
  'cursor' | 'limit' | 'sort' | 'direction'
> & { offset?: number };

@Injectable()
export class GithubSearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly issues: IssuesService,
    private readonly repositories: RepositoryNodesService,
    private readonly issueNodes: IssueNodesService,
  ) {}

  async search(
    type: SearchType,
    query: string,
    viewer: GithubViewer | null,
    loaders: Loaders,
    first?: number,
    last?: number,
    after?: string,
  ) {
    if (type !== SearchType.ISSUE) return EMPTY;
    const found = await this.findIssues(query, viewer, loaders, {
      cursor: after,
      limit: Math.min(first ?? last ?? 30, 100),
    });
    const nodes = await perRepository(
      found.issues,
      found.repositories,
      (repository, issues) => this.issueNodes.toNodes(issues, repository),
    );
    return {
      issueCount: found.count,
      nodes,
      edges: nodes.map((node, index) => ({
        node,
        cursor: issueCursor(found.issues[index]!, 'created'),
      })),
      pageInfo: {
        hasNextPage: found.hasMore,
        hasPreviousPage: !!after,
        startCursor: null,
        endCursor: found.nextCursor,
      },
    };
  }

  /** The issues and pull requests GitHub's issue search syntax finds, for GraphQL `search` and REST `/search/issues`. One `repo:` alone searches that repository, answering NOT_FOUND when the viewer cannot reach it; anything else searches every repository the viewer can read that the `repo:`, `user:`, `org:` and `is:public`/`is:private` qualifiers keep. */
  async findIssues(
    query: string,
    viewer: GithubViewer | null,
    loaders: Loaders,
    paging: IssueSearchPaging,
  ) {
    const nothing = {
      issues: [],
      repositories: new Map<string, RepositoryNode>(),
      count: 0,
      hasMore: false,
      nextCursor: null,
    };
    const search = parseIssueSearch(query);
    const viewerLogin = viewer
      ? ((await loaders.usersById.load(viewer.userId))?.username ?? undefined)
      : undefined;
    const me = (login: string | undefined) =>
      login === '@me' ? (viewerLogin ?? '') : login;
    const wanted = search.reviewRequested;
    let reviewRequested: IssueListOptions['reviewRequested'];
    if (wanted && 'login' in wanted) {
      const reviewer = await loaders.usersByLogin.load(me(wanted.login)!);
      reviewRequested = reviewer
        ? { userId: reviewer.id, direct: wanted.direct }
        : undefined;
    } else if (wanted) {
      const [organization] = await this.db
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(sameName(schema.organization.slug, wanted.organization));
      const team = organization
        ? (await organizationTeams(this.db, organization.id)).find(
            (team) => team.slug === wanted.slug.toLowerCase(),
          )
        : undefined;
      reviewRequested = team ? { teamId: team.id } : undefined;
    }
    // A user or team that does not exist has no review requests.
    if (wanted && !reviewRequested) return nothing;

    const issueQuery: GetIssuesQueryDTO = {
      state: search.state,
      author: me(search.author),
      assignee: me(search.assignee),
      labels: search.labels.join(',') || undefined,
      q: search.text || undefined,
      cursor: paging.cursor,
      limit: paging.limit,
      sort: paging.sort,
      direction: paging.direction,
    };
    const options: IssueListOptions = {
      offset: paging.offset,
      reviewRequested,
      ...(search.isPullRequest === true
        ? {
            pullRequests: {
              states:
                search.merged === null
                  ? undefined
                  : search.merged
                    ? ['merged']
                    : ['open', 'closed'],
            },
          }
        : { includePullRequests: search.isPullRequest === null }),
    };
    const [only] = search.repos;
    const repository =
      only &&
      search.repos.length === 1 &&
      search.owners.length === 0 &&
      !search.visibility
        ? await this.repositories.repository(only.owner, only.name, viewer)
        : null;
    const owner = ownerNameOf(schema.user, schema.organization);
    const named = [
      ...search.repos.map(({ owner: login, name }) =>
        and(sameName(owner, login), sameName(schema.repository.slug, name)),
      ),
      ...search.owners.map((login) => sameName(owner, login)),
    ];
    const page = repository
      ? await this.issues.getIssues(
          {
            username: repository.ownerLogin,
            repo: repository.slug,
            requesterId: viewer?.userId,
            query: issueQuery,
          },
          options,
        )
      : await this.issues.searchIssues(
          {
            requesterId: viewer?.userId,
            repositories: and(
              named.length > 0 ? or(...named) : undefined,
              search.visibility
                ? eq(schema.repository.visibility, search.visibility)
                : undefined,
              tokenReaches(viewer),
            ),
            query: issueQuery,
          },
          options,
        );
    return {
      issues: page.issues,
      repositories: new Map(
        await Promise.all(
          [...new Set(page.issues.map((issue) => issue.repositoryId))].map(
            async (id) =>
              [id, await this.repositories.load(id, viewer)] as const,
          ),
        ),
      ),
      count:
        search.state === 'open'
          ? page.openCount
          : search.state === 'closed'
            ? page.closedCount
            : page.total,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}
