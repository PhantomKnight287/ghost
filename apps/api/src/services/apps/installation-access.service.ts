import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { installationCovers } from '../../lib/repositories/access/repository-access.js';
import type { AppInstallationCaller } from '../../github/auth/github-request.js';

@Injectable()
export class InstallationAccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Whether the caller's own installation covers the repository, and its token was not narrowed away from it. The bot's role may come from another installation of the same app; only this answers for the token in hand. */
  async covers(caller: AppInstallationCaller, repositoryId: string) {
    if (caller.repositoryIds && !caller.repositoryIds.includes(repositoryId))
      return false;
    const [row] = await this.db
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .innerJoin(
        schema.appInstallation,
        eq(schema.appInstallation.id, caller.installationId),
      )
      .where(
        and(
          eq(schema.repository.id, repositoryId),
          installationCovers(schema.repository),
        ),
      );
    return row !== undefined;
  }

  /** Whether the issue `number`, or the issue comment with REST id `commentId`, belongs to a pull request of the repository. */
  async onPullRequest(
    repositoryId: string,
    { number, commentId }: { number?: number; commentId?: number },
  ) {
    const [row] = await this.db
      .select({ isPullRequest: schema.issue.isPullRequest })
      .from(schema.issue)
      .leftJoin(
        schema.issueComment,
        eq(schema.issueComment.issueId, schema.issue.id),
      )
      .where(
        and(
          eq(schema.issue.repositoryId, repositoryId),
          number !== undefined
            ? eq(schema.issue.number, number)
            : eq(schema.issueComment.numericId, commentId!),
        ),
      )
      .limit(1);
    return row?.isPullRequest === true;
  }
}
