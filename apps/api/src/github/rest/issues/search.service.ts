import type { Database } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../../database/database.module.js';
import { createLoaders } from '../../../lib/github/loaders.js';
import { perRepository } from '../../../lib/github/per-repository.js';
import { pageOf, RestSearchPage } from '../../../lib/github/rest.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { GithubSearchService } from '../../graphql/resolvers/search/search.service.js';
import type { GithubSearchIssuesQueryDTO } from './dto/search.dto.js';
import { GithubIssuesService } from './issues.service.js';

@Injectable()
export class GithubSearchIssuesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly searches: GithubSearchService,
    private readonly issues: GithubIssuesService,
  ) {}

  async search(viewer: GithubViewer | null, query: GithubSearchIssuesQueryDTO) {
    const page = pageOf(query);
    const found = await this.searches.findIssues(
      query.q,
      viewer,
      createLoaders(this.db),
      {
        offset: page.offset,
        limit: page.perPage,
        sort:
          query.sort === 'created' ||
          query.sort === 'updated' ||
          query.sort === 'comments'
            ? query.sort
            : undefined,
        direction: query.order,
      },
    );
    return new RestSearchPage(
      await perRepository(
        found.issues,
        found.repositories,
        (repository, issues) => this.issues.issues(repository, issues),
      ),
      page,
      found.count,
    );
  }
}
