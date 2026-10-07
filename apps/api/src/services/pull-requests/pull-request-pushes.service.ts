import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { MAX_PUSH_COMMITS, publishEvent } from '../../lib/events/events.js';
import { isAncestor } from '../../lib/git/diff/diff.js';
import { resolveCommit } from '../../lib/git/tree/resolve-ref.js';
import { type RefTransition, ZERO_OID } from '../../lib/git/wal/wal.types.js';
import {
  commitsAdded,
  recordCommitEvents,
} from '../../lib/pull-requests/commit-events.js';
import { RepositoryMaterializerService } from '../git/materializer/repository-materializer.service.js';

const BRANCH_PREFIX = 'refs/heads/';

/** Puts what a push did to an open pull request's head into its timeline. Every writer of a branch calls it once the push has landed: git pushes, applied suggestions, and merges into a branch another request is from. */
@Injectable()
export class PullRequestPushesService {
  private readonly logger = new Logger(PullRequestPushesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly materializer: RepositoryMaterializerService,
  ) {}

  /** Never rejects: the push it follows has already landed, and a missing timeline entry must not fail it. */
  async recordPush(push: {
    repositoryId: string;
    transitions: RefTransition[];
    pushedBy: string | null;
  }) {
    await this.record(push).catch((error: unknown) =>
      this.logger.warn(
        `Pull request commits were not recorded for ${push.repositoryId}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  private async record({
    repositoryId,
    transitions,
    pushedBy,
  }: {
    repositoryId: string;
    transitions: RefTransition[];
    pushedBy: string | null;
  }) {
    // a deleted branch adds nothing; its request shows the head as gone
    const moved = new Map(
      transitions
        .filter(
          ({ ref, newOid }) =>
            ref.startsWith(BRANCH_PREFIX) && !newOid.equals(ZERO_OID),
        )
        .map(({ ref, oldOid, newOid }) => [
          ref.slice(BRANCH_PREFIX.length),
          {
            before: oldOid.equals(ZERO_OID) ? null : oldOid.toString('hex'),
            after: newOid.toString('hex'),
          },
        ]),
    );
    if (moved.size === 0) return;

    const affected = await this.db
      .select({
        issueId: schema.pullRequest.issueId,
        baseRepositoryId: schema.pullRequest.baseRepositoryId,
        baseRef: schema.pullRequest.baseRef,
        headRef: schema.pullRequest.headRef,
      })
      .from(schema.pullRequest)
      .where(
        and(
          eq(schema.pullRequest.state, 'open'),
          eq(schema.pullRequest.headRepositoryId, repositoryId),
          inArray(schema.pullRequest.headRef, [...moved.keys()]),
        ),
      );
    if (affected.length === 0) return;

    const repositories = await this.db
      .select({
        id: schema.repository.id,
        defaultBranch: schema.repository.defaultBranch,
      })
      .from(schema.repository)
      .where(
        inArray(schema.repository.id, [
          repositoryId,
          ...affected.map((pull) => pull.baseRepositoryId),
        ]),
      );
    const directoryOf = (id: string) => {
      const repository = repositories.find((row) => row.id === id);
      if (!repository) throw new Error(`Repository ${id} is gone`);
      return this.materializer.open(repository);
    };
    const headDirectory = await directoryOf(repositoryId);

    for (const pull of affected) {
      const { before, after } = moved.get(pull.headRef)!;
      const baseDirectory = await directoryOf(pull.baseRepositoryId);
      const alternates =
        pull.baseRepositoryId === repositoryId ? [] : [headDirectory];
      const baseSha = await resolveCommit(
        baseDirectory,
        `${BRANCH_PREFIX}${pull.baseRef}`,
      );
      const forced =
        before !== null && !(await isAncestor(headDirectory, before, after));
      // a rewritten head's old tip may be gone, and git refuses to exclude an object it cannot find
      const previous = before && (await resolveCommit(headDirectory, before));

      const commits = await commitsAdded({
        gitDir: baseDirectory,
        alternates,
        tip: after,
        exclude: [baseSha, previous].filter((sha) => sha !== null),
      });
      await this.db.transaction(async (tx) => {
        await recordCommitEvents(tx, {
          issueId: pull.issueId,
          actorId: pushedBy,
          commits,
          forced: forced ? { before, after } : undefined,
        });
        // webhooks only: nobody's inbox fills up with every push to a request they follow
        await publishEvent(tx, {
          type: 'pull_request.synchronized',
          repositoryId: pull.baseRepositoryId,
          actorId: pushedBy,
          payload: {
            issueId: pull.issueId,
            before: before ?? ZERO_OID.toString('hex'),
            after,
            forced,
            commits: commits.toReversed().slice(0, MAX_PUSH_COMMITS),
          },
        });
      });
    }
  }
}
