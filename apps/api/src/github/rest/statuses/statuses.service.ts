import type { Database } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DATABASE } from '../../../database/database.module.js';
import { NoCommitFoundError } from '../../../lib/github/github.errors.js';
import { commitStatusNumericIdsOf } from '../../../lib/github/node-lookup.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import {
  pageOf,
  RestPage,
  toCombinedStatusRest,
  toRepositoryRest,
  toStatusRest,
} from '../../../lib/github/rest.js';
import { CommitNotFoundError } from '../../../lib/repositories/repositories.errors.js';
import { CommitStatusesService } from '../../../resources/commit-statuses/commit-statuses.service.js';
import type { CommitStatusDTO } from '../../../resources/commit-statuses/dto/commit-status.dto.js';
import type { GithubRepositoryTarget } from '../../auth/github-request.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import type { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import type { GithubCreateStatusDTO } from './dto/status.dto.js';

/** GitHub's REST commit statuses over CommitStatusesService: its statuses plus the integer ids, users and URLs GitHub's shapes embed. */
@Injectable()
export class GithubStatusesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubIssuesService,
    private readonly statuses: CommitStatusesService,
    private readonly config: ConfigService,
  ) {}

  async create(
    { owner, repo, viewer }: GithubRepositoryTarget,
    sha: string,
    body: GithubCreateStatusDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/statuses/:sha',
    );
    const status = await this.statuses.create({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      installationId: signedIn.installation?.installationId,
      sha,
      body: {
        state: body.state,
        targetUrl: body.target_url ?? undefined,
        description: body.description ?? undefined,
        context: body.context,
      },
    });
    const { statuses } = await this.rest(repository, [status], sha);
    return statuses[0]!;
  }

  async list(
    { owner, repo, viewer }: GithubRepositoryTarget,
    ref: string,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const { sha, statuses, total } = await this.onCommit(
      ref,
      this.statuses.pageStatuses({
        ...this.github.ref(repository, viewer),
        ref,
        offset: page.offset,
        limit: page.perPage,
      }),
    );
    return new RestPage(
      (await this.rest(repository, statuses, sha)).statuses,
      page,
      total,
    );
  }

  async combined({ owner, repo, viewer }: GithubRepositoryTarget, ref: string) {
    const repository = await this.github.readable(owner, repo, viewer);
    const combined = await this.onCommit(
      ref,
      this.statuses.combined({ ...this.github.ref(repository, viewer), ref }),
    );
    const { statuses, context } = await this.rest(
      repository,
      combined.statuses,
      combined.sha,
    );
    return toCombinedStatusRest(
      combined,
      statuses,
      toRepositoryRest(repository, githubOrigins(this.config)),
      context,
    );
  }

  private async rest(
    repository: RepositoryNode,
    statuses: CommitStatusDTO[],
    sha: string,
  ) {
    const [numericIds, context] = await Promise.all([
      commitStatusNumericIdsOf(
        this.db,
        statuses.map((status) => status.id),
      ),
      this.github.context(repository, {
        logins: statuses.flatMap((status) => status.creator?.username ?? []),
        labels: [],
      }),
    ]);
    return {
      context,
      statuses: statuses.map((status) =>
        toStatusRest(status, numericIds.get(status.id)!, sha, context),
      ),
    };
  }

  /** GitHub names the ref when it resolves to no commit, where its other 404s say only "Not Found". */
  private async onCommit<T>(ref: string, read: Promise<T>) {
    try {
      return await read;
    } catch (error) {
      if (error instanceof CommitNotFoundError)
        throw new NoCommitFoundError(ref);
      throw error;
    }
  }
}
