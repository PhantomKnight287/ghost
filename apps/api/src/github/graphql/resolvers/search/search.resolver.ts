import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { parseIssueSearch } from '../../../../lib/github/issue-search.js';
import { toIssueNode } from '../../../../lib/github/nodes.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { SearchType } from '../../enums.js';
import { SearchResultItemConnection } from '../../types/search.type.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';

const EMPTY = { issueCount: 0, nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } };

@Resolver()
@AllowAnonymous()
export class SearchResolver {
  constructor(
    private readonly issues: IssuesService,
    private readonly repositories: RepositoryResolver,
  ) {}

  @Query(() => SearchResultItemConnection)
  async search(
    @Args('type', { type: () => SearchType }) type: SearchType,
    @Args('query') query: string,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    // gh asks with `last: $limit`; search results have no "end" to count back from, so last reads as first.
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    const search = parseIssueSearch(query);
    // ponytail: only repository-scoped issue search; global search across repositories needs its own query over every readable repository.
    if (type !== SearchType.ISSUE || !search.repo || search.isPullRequest === true) return EMPTY;
    const repository = await this.repositories.repository(search.repo.owner, search.repo.name, viewer);
    const page = await this.issues.getIssues({
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: viewer?.userId,
      query: { state: search.state, author: search.author, assignee: search.assignee, labels: search.labels.join(',') || undefined, q: search.text || undefined, cursor: after, limit: Math.min(first ?? last ?? 30, 100) },
    });
    return {
      issueCount: search.state === 'open' ? page.openCount : search.state === 'closed' ? page.closedCount : page.total,
      nodes: page.issues.map((issue) => toIssueNode(issue, repository)),
      pageInfo: { hasNextPage: page.hasMore, hasPreviousPage: !!after, startCursor: null, endCursor: page.nextCursor },
    };
  }
}
