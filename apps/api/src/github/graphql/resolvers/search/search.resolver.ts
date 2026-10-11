import { Args, Context, Int, Query, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { parseIssueSearch } from '../../../../lib/github/issue-search.js';
import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { issueCursor } from '../../connection.js';
import { SearchType } from '../../enums.js';
import { SearchResultItemConnection } from '../../types/search.type.js';
import { IssueResolver } from '../issue/issue.resolver.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';

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

@Resolver()
@AllowAnonymous()
export class SearchResolver {
  constructor(
    private readonly issues: IssuesService,
    private readonly repositories: RepositoryResolver,
    private readonly issueNodes: IssueResolver,
  ) {}

  @Query(() => SearchResultItemConnection)
  async search(
    @Args('type', { type: () => SearchType }) type: SearchType,
    @Args('query') query: string,
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    // gh asks with `last: $limit`; search results have no "end" to count back from, so last reads as first.
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    const search = parseIssueSearch(query);
    // ponytail: only repository-scoped issue search; global search across repositories needs its own query over every readable repository.
    // Ghost has no review requests, so nobody has one pending.
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
