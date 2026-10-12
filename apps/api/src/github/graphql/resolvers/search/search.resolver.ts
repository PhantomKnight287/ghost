import { Args, Context, Int, Query, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { SearchType } from '../../enums.js';
import { SearchResultItemConnection } from '../../types/search.type.js';
import { GithubSearchService } from './search.service.js';

@Resolver()
@AllowAnonymous()
export class SearchResolver {
  constructor(private readonly searches: GithubSearchService) {}

  @Query(() => SearchResultItemConnection)
  search(
    @Args('type', { type: () => SearchType }) type: SearchType,
    @Args('query') query: string,
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    // gh asks with `last: $limit`; search results have no "end" to count back from, so last reads as first.
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    return this.searches.search(
      type,
      query,
      viewer,
      loaders,
      first,
      last,
      after,
    );
  }
}
