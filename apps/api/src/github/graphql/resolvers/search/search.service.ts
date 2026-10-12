import { Injectable } from '@nestjs/common';

import { parseIssueSearch } from '../../../../lib/github/issue-search.js';
import type { Loaders } from '../../../../lib/github/loaders.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { issueCursor } from '../../connection.js';
import { SearchType } from '../../enums.js';
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

@Injectable()
export class GithubSearchService {
  constructor(
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
    const search = parseIssueSearch(query);
    // ponytail: only repository-scoped issue search; global search across repositories needs its own query over every readable repository. Ghost has no review requests, so `review-requested:` matches nothing.
    if (type !== SearchType.ISSUE || !search.repo || search.reviewRequested)
      return EMPTY;
    const repository = await this.repositories.repository(
      search.repo.owner,
      search.repo.name,
      viewer,
    );
    const viewerLogin = viewer
      ? ((await loaders.usersById.load(viewer.userId))?.username ?? undefined)
      : undefined;
    const me = (login: string | undefined) =>
      login === '@me' ? (viewerLogin ?? '') : login;
    const page = await this.issues.getIssues(
      {
        username: repository.ownerLogin,
        repo: repository.slug,
        requesterId: viewer?.userId,
        query: {
          state: search.state,
          author: me(search.author),
          assignee: me(search.assignee),
          labels: search.labels.join(',') || undefined,
          q: search.text || undefined,
          cursor: after,
          limit: Math.min(first ?? last ?? 30, 100),
        },
      },
      search.isPullRequest === true
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
        : { includePullRequests: search.isPullRequest === null },
    );
    const nodes = await this.issueNodes.toNodes(page.issues, repository);
    return {
      issueCount:
        search.state === 'open'
          ? page.openCount
          : search.state === 'closed'
            ? page.closedCount
            : page.total,
      nodes,
      edges: nodes.map((node, index) => ({
        node,
        cursor: issueCursor(page.issues[index]!, 'created'),
      })),
      pageInfo: {
        hasNextPage: page.hasMore,
        hasPreviousPage: !!after,
        startCursor: null,
        endCursor: page.nextCursor,
      },
    };
  }
}
