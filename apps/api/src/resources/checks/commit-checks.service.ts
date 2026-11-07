import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { rollupState } from '../../lib/checks/checks.js';
import { combinedState } from '../../lib/commit-statuses/commit-statuses.js';
import type { RefFacts } from '../../lib/rulesets/rulesets.types.js';
import { CommitStatusesService } from '../commit-statuses/commit-statuses.service.js';
import { ChecksService } from './checks.service.js';
import type { CommitChecksDTO } from './dto/check.dto.js';

type RequiredFacts = NonNullable<RefFacts['statuses']>;

/** The App ID of a result's app while it is not deleted. */
const liveAppId = () =>
  sql<
    number | null
  >`case when ${schema.app.deletedAt} is null then ${schema.app.numericId} end`.mapWith(
    Number,
  );

/** What a commit reports, statuses and check runs together: the tick, the merge panel and required checks all read this. */
@Injectable()
export class CommitChecksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly checks: ChecksService,
    private readonly statuses: CommitStatusesService,
  ) {}

  /** Each sha's newest status per context and newest run per app and name across `repositoryIds`, the first repository winning, with their combined state. Callers pass repositories they already authorized. A sha with neither is absent. */
  async checksFor(
    repositoryIds: string[],
    shas: string[],
  ): Promise<Map<string, CommitChecksDTO>> {
    const [statuses, runs] = await Promise.all([
      this.statuses.combinedFor(repositoryIds, shas),
      this.checks.latestRunsFor(repositoryIds, shas),
    ]);
    const result = new Map<string, CommitChecksDTO>();
    for (const sha of new Set([...statuses.keys(), ...runs.keys()])) {
      const ofSha = statuses.get(sha)?.statuses ?? [];
      const checkRuns = runs.get(sha) ?? [];
      result.set(sha, {
        sha,
        state: combinedState([
          ...ofSha.map((status) => status.state),
          ...checkRuns.map(rollupState),
        ]),
        statuses: ofSha,
        checkRuns,
      });
    }
    return result;
  }

  /** What status check rules read about each sha of one repository, newest first: the newest status of each context and the newest run of each name, per app that posted it (`appId`, the App ID) and once more without one. A deleted app's results count as posted without an app, so a check pinned to it can no longer be met. A sha with neither is absent. */
  async requiredChecks(
    repositoryId: string,
    shas: string[],
  ): Promise<Map<string, RequiredFacts>> {
    if (shas.length === 0) return new Map();
    const [statuses, runs] = await Promise.all([
      this.requiredStatuses(repositoryId, shas),
      this.requiredRuns(repositoryId, shas),
    ]);
    const rows = [...statuses, ...runs].sort(
      (a, b) => b.at.getTime() - a.at.getTime() || b.order - a.order,
    );
    const bySha = new Map<string, RequiredFacts>();
    for (const { sha, context, state, appId } of rows)
      bySha.set(sha, [...(bySha.get(sha) ?? []), { context, state, appId }]);
    return bySha;
  }

  private async requiredStatuses(repositoryId: string, shas: string[]) {
    const status = schema.commitStatus;
    const appId = liveAppId();
    const rows = await this.db
      .selectDistinctOn([status.sha, status.context, appId], {
        sha: status.sha,
        context: status.context,
        state: status.state,
        appId,
        at: status.createdAt,
        order: status.numericId,
      })
      .from(status)
      .leftJoin(
        schema.appInstallation,
        eq(schema.appInstallation.id, status.installationId),
      )
      .leftJoin(schema.app, eq(schema.app.id, schema.appInstallation.appId))
      .where(
        and(eq(status.repositoryId, repositoryId), inArray(status.sha, shas)),
      )
      .orderBy(
        asc(status.sha),
        asc(status.context),
        asc(appId),
        desc(status.createdAt),
        desc(status.numericId),
      );
    return rows;
  }

  private async requiredRuns(repositoryId: string, shas: string[]) {
    const run = schema.checkRun;
    const appId = liveAppId();
    const rows = await this.db
      // Grouped by the suite's app so two deleted apps' runs stay apart; `appId` stays null for them, so a pinned check still fails closed.
      .selectDistinctOn([run.headSha, run.name, schema.checkSuite.appId], {
        sha: run.headSha,
        context: run.name,
        status: run.status,
        conclusion: run.conclusion,
        appId,
        // The app sends `completed_at`; capping it at the server's last write keeps a run dated in the future from outranking later ones.
        at: sql<Date>`least(${run.completedAt}, ${run.updatedAt})`.mapWith(
          (value: string | Date) => new Date(value),
        ),
        order: run.numericId,
      })
      .from(run)
      .innerJoin(schema.checkSuite, eq(schema.checkSuite.id, run.suiteId))
      .innerJoin(schema.app, eq(schema.app.id, schema.checkSuite.appId))
      .where(
        and(eq(run.repositoryId, repositoryId), inArray(run.headSha, shas)),
      )
      .orderBy(
        asc(run.headSha),
        asc(run.name),
        asc(schema.checkSuite.appId),
        desc(run.createdAt),
        desc(run.numericId),
      );
    return rows.map(({ status, conclusion, ...row }) => ({
      ...row,
      state: rollupState({ status, conclusion }),
    }));
  }
}
