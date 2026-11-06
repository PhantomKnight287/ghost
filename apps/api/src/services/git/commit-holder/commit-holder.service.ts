import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { resolveCommit } from '../../../lib/git/tree/resolve-ref.js';
import { RepositoryMaterializerService } from '../materializer/repository-materializer.service.js';

/** Which commits a repository may have statuses and checks reported on. */
@Injectable()
export class CommitHolderService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly materializer: RepositoryMaterializerService,
  ) {}

  /** Whether `sha` is a commit of the repository, or of a fork with a pull request open into it: a fork's head lives in the fork's objects, and the base's CI reports on it here. */
  async holds(
    repository: { id: string; defaultBranch: string | null },
    sha: string,
  ) {
    // resolveCommit peels tags, so a tag object's sha resolves to another oid.
    const isCommit = async (holder: typeof repository) =>
      (await resolveCommit(await this.materializer.open(holder), sha)) === sha;
    if (await isCommit(repository)) return true;

    const forks = await this.db
      .selectDistinct({
        id: schema.repository.id,
        defaultBranch: schema.repository.defaultBranch,
      })
      .from(schema.pullRequest)
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.pullRequest.headRepositoryId),
      )
      .where(
        and(
          eq(schema.pullRequest.baseRepositoryId, repository.id),
          eq(schema.pullRequest.state, 'open'),
          ne(schema.pullRequest.headRepositoryId, repository.id),
        ),
      );
    // ponytail: opens each fork with an open request in turn; fine for a handful, a sha → pull request lookup if a repository collects many forks.
    for (const fork of forks) {
      if (await isCommit(fork)) return true;
    }
    return false;
  }
}
