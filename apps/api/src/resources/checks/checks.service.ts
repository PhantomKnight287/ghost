import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  type CheckStatus,
  MAX_ANNOTATIONS_PER_RUN,
  MAX_RUNS_PER_NAME,
  resolveRunWrite,
  suiteState,
} from '../../lib/checks/checks.js';
import {
  CheckRunNotFoundError,
  CheckSuiteNotFoundError,
  ChecksNeedInstallationError,
  NotRunOwnerError,
  TooManyAnnotationsError,
  TooManyCheckRunsError,
} from '../../lib/checks/checks.errors.js';
import { InvalidStatusShaError } from '../../lib/commit-statuses/commit-statuses.errors.js';
import type { Executor } from '../../lib/db/executor.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import { publishEvent } from '../../lib/events/events.js';
import { CommitHolderService } from '../../services/git/commit-holder/commit-holder.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import type {
  CheckAnnotationDTO,
  CheckAnnotationInput,
  CheckAppDTO,
  CheckRunDTO,
  CheckRunInput,
  CheckSuiteDTO,
} from './dto/check.dto.js';

type RepositoryRef = { username: string; repo: string };
type Reader = RepositoryRef & { requesterId?: string };

/** Who is writing: the installation behind a `ghs_` token, and its bot as the requester. Anything else is refused writes. */
export type ChecksCaller = RepositoryRef & {
  requesterId: string;
  installation: { installationId: string; appId: string } | null;
};

export type RunsQuery = {
  checkName?: string;
  status?: CheckStatus;
  /** `latest`: the newest run per app and name. */
  filter: 'latest' | 'all';
  /** The App ID. */
  appId?: number;
  offset: number;
  limit: number;
};

const run = schema.checkRun;
const suite = schema.checkSuite;

const appColumn = sql<CheckAppDTO>`json_build_object('appId', ${schema.app.numericId}, 'slug', ${schema.app.slug}, 'name', ${schema.app.name}, 'logoUrl', ${schema.app.logoUrl}, 'deleted', ${schema.app.deletedAt} is not null)`;

const runColumns = {
  id: run.id,
  suiteId: run.suiteId,
  name: run.name,
  headSha: run.headSha,
  status: run.status,
  conclusion: run.conclusion,
  startedAt: sql<string | null>`${isoTimestamp(run.startedAt)}`,
  completedAt: sql<string | null>`${isoTimestamp(run.completedAt)}`,
  externalId: run.externalId,
  detailsUrl: run.detailsUrl,
  output: sql<
    CheckRunDTO['output']
  >`json_build_object('title', ${run.outputTitle}, 'summary', ${run.outputSummary}, 'text', ${run.outputText}, 'annotationsCount', (select count(*)::int from ${schema.checkAnnotation} where ${schema.checkAnnotation.runId} = ${run.id}))`,
  actions: run.actions,
  app: appColumn,
  createdAt: isoTimestamp(run.createdAt),
  updatedAt: isoTimestamp(run.updatedAt),
};

const suiteColumns = {
  id: suite.id,
  headSha: suite.headSha,
  headBranch: suite.headBranch,
  status: suite.status,
  conclusion: suite.conclusion,
  before: suite.before,
  after: suite.after,
  app: appColumn,
  runsCount: sql<number>`(select count(*)::int from ${run} where ${run.suiteId} = ${suite.id})`,
  createdAt: isoTimestamp(suite.createdAt),
  updatedAt: isoTimestamp(suite.updatedAt),
};

/** Newest first; the numeric id breaks ties between rows written in the same instant. */
const newestFirst = [desc(run.createdAt), desc(run.numericId)];

/** GitHub's check runs and check suites: apps write them through installation tokens, anyone who can read the repository reads them. */
@Injectable()
export class ChecksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly commitHolder: CommitHolderService,
  ) {}

  async createRun(
    caller: ChecksCaller,
    body: CheckRunInput & { name: string; headSha: string },
  ): Promise<CheckRunDTO> {
    const { repository, installation } = await this.writable(caller);
    await this.assertHolds(repository, body.headSha);
    const state = resolveRunWrite(null, body, new Date());

    const id = await this.db.transaction(async (tx) => {
      const suiteId = await this.ensureSuite(tx, {
        repositoryId: repository.id,
        headSha: body.headSha,
        installation,
      });
      // ponytail: two concurrent creates can both pass at 999 and land at 1001; a per-name lock if the cap must be exact.
      const [existing] = await tx
        .select({ count: count() })
        .from(run)
        .where(
          and(
            eq(run.repositoryId, repository.id),
            eq(run.headSha, body.headSha),
            eq(run.name, body.name),
          ),
        );
      if ((existing?.count ?? 0) >= MAX_RUNS_PER_NAME)
        throw new TooManyCheckRunsError(body.headSha, body.name);

      const [row] = await tx
        .insert(run)
        .values({
          suiteId,
          repositoryId: repository.id,
          headSha: body.headSha,
          name: body.name,
          ...state,
          completedOnce: state.status === 'completed',
          externalId: body.externalId ?? null,
          detailsUrl: body.detailsUrl ?? null,
          outputTitle: body.output?.title ?? null,
          outputSummary: body.output?.summary ?? null,
          outputText: body.output?.text ?? null,
          actions: body.actions ?? [],
        })
        .returning({ id: run.id });
      await this.appendAnnotations(tx, row.id, body.output?.annotations);
      const event = {
        repositoryId: repository.id,
        actorId: caller.requesterId,
      };
      await publishEvent(tx, {
        type: 'check_run.created',
        ...event,
        payload: { checkRunId: row.id },
      });
      if (state.status === 'completed')
        await publishEvent(tx, {
          type: 'check_run.completed',
          ...event,
          payload: { checkRunId: row.id },
        });
      await this.recomputeSuite(tx, suiteId, caller.requesterId);
      return row.id;
    });
    return this.runById(repository.id, id);
  }

  async updateRun(
    caller: ChecksCaller,
    runId: string,
    body: CheckRunInput,
  ): Promise<CheckRunDTO> {
    const { repository, installation } = await this.writable(caller);

    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          suiteId: run.suiteId,
          appId: suite.appId,
          status: run.status,
          conclusion: run.conclusion,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          completedOnce: run.completedOnce,
          detailsUrl: run.detailsUrl,
        })
        .from(run)
        .innerJoin(suite, eq(suite.id, run.suiteId))
        .where(and(eq(run.id, runId), eq(run.repositoryId, repository.id)))
        .for('update', { of: run });
      if (!current) throw new CheckRunNotFoundError();
      if (current.appId !== installation.appId)
        throw new NotRunOwnerError(await this.appNumericId(installation.appId));

      const detailsUrl =
        body.detailsUrl === undefined ? current.detailsUrl : body.detailsUrl;
      const state = resolveRunWrite(
        { ...current, startedAt: current.startedAt ?? new Date() },
        { ...body, detailsUrl },
        new Date(),
      );
      const completesNow =
        state.status === 'completed' && !current.completedOnce;
      await tx
        .update(run)
        .set({
          ...state,
          ...(body.name !== undefined && { name: body.name }),
          ...(body.externalId !== undefined && { externalId: body.externalId }),
          detailsUrl,
          ...(body.output && {
            outputTitle: body.output.title,
            outputSummary: body.output.summary,
            ...(body.output.text !== undefined && {
              outputText: body.output.text,
            }),
          }),
          ...(body.actions && { actions: body.actions }),
          ...(completesNow && { completedOnce: true }),
          updatedAt: new Date(),
        })
        .where(eq(run.id, runId));
      await this.appendAnnotations(tx, runId, body.output?.annotations);
      if (completesNow)
        await publishEvent(tx, {
          type: 'check_run.completed',
          repositoryId: repository.id,
          actorId: caller.requesterId,
          payload: { checkRunId: runId },
        });
      await this.recomputeSuite(tx, current.suiteId, caller.requesterId);
    });
    return this.runById(repository.id, runId);
  }

  async getRun(target: Reader, runId: string): Promise<CheckRunDTO> {
    const repository = await this.readable(target);
    return this.runById(repository.id, runId);
  }

  /** Every run on the commit `ref` names, newest first, as offset pages with the total. */
  async runsForRef(
    target: Reader,
    ref: string,
    query: RunsQuery,
  ): Promise<{ sha: string; runs: CheckRunDTO[]; total: number }> {
    const repository = await this.readable(target);
    const sha = await this.commitHolder.commitOf(repository, ref);
    const page = await this.pageRuns(
      and(eq(run.repositoryId, repository.id), eq(run.headSha, sha))!,
      query,
    );
    return { sha, ...page };
  }

  async runsOfSuite(
    target: Reader,
    suiteId: string,
    query: RunsQuery,
  ): Promise<{ runs: CheckRunDTO[]; total: number }> {
    const repository = await this.readable(target);
    await this.suiteById(repository.id, suiteId);
    return this.pageRuns(eq(run.suiteId, suiteId), query);
  }

  /** A run's annotations in the order they were added. */
  async annotations(
    target: Reader,
    runId: string,
    { offset, limit }: { offset: number; limit: number },
  ): Promise<{ annotations: CheckAnnotationDTO[]; total: number }> {
    const repository = await this.readable(target);
    await this.runById(repository.id, runId);
    const annotation = schema.checkAnnotation;
    const where = eq(annotation.runId, runId);
    const [annotations, [total]] = await Promise.all([
      this.db
        .select({
          path: annotation.path,
          startLine: annotation.startLine,
          endLine: annotation.endLine,
          startColumn: annotation.startColumn,
          endColumn: annotation.endColumn,
          annotationLevel: annotation.annotationLevel,
          message: annotation.message,
          title: annotation.title,
          rawDetails: annotation.rawDetails,
        })
        .from(annotation)
        .where(where)
        .orderBy(asc(annotation.numericId))
        .limit(limit)
        // ponytail: OFFSET scans the rows it skips; at most 1000 per run keeps that small.
        .offset(offset),
      this.db.select({ total: count() }).from(annotation).where(where),
    ]);
    return { annotations, total: total?.total ?? 0 };
  }

  /** The caller's app's suite on `headSha`, made if it has none. */
  async createSuite(
    caller: ChecksCaller,
    headSha: string,
  ): Promise<CheckSuiteDTO> {
    const { repository, installation } = await this.writable(caller);
    await this.assertHolds(repository, headSha);
    const id = await this.ensureSuite(this.db, {
      repositoryId: repository.id,
      headSha,
      installation,
    });
    return this.suiteById(repository.id, id);
  }

  async getSuite(target: Reader, suiteId: string): Promise<CheckSuiteDTO> {
    const repository = await this.readable(target);
    return this.suiteById(repository.id, suiteId);
  }

  /** The suites on the commit `ref` names, oldest first, as GitHub lists them. */
  async suitesForRef(
    target: Reader,
    ref: string,
    query: {
      appId?: number;
      checkName?: string;
      offset: number;
      limit: number;
    },
  ): Promise<{ sha: string; suites: CheckSuiteDTO[]; total: number }> {
    const repository = await this.readable(target);
    const sha = await this.commitHolder.commitOf(repository, ref);
    const where = and(
      eq(suite.repositoryId, repository.id),
      eq(suite.headSha, sha),
      query.appId === undefined
        ? undefined
        : eq(schema.app.numericId, query.appId),
      query.checkName === undefined
        ? undefined
        : sql`exists (select 1 from ${run} where ${run.suiteId} = ${suite.id} and ${run.name} = ${query.checkName})`,
    );
    const [suites, [total]] = await Promise.all([
      this.db
        .select(suiteColumns)
        .from(suite)
        .innerJoin(schema.app, eq(schema.app.id, suite.appId))
        .where(where)
        .orderBy(asc(suite.numericId))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(suite)
        .innerJoin(schema.app, eq(schema.app.id, suite.appId))
        .where(where),
    ]);
    return { sha, suites, total: total?.total ?? 0 };
  }

  /** The newest run per app and name on each sha across `repositoryIds`: a run posted in several takes the first repository's, so a fork cannot override the base's checks. Callers pass repositories they already authorized. A sha without runs is absent. */
  async latestRunsFor(
    repositoryIds: string[],
    shas: string[],
  ): Promise<Map<string, CheckRunDTO[]>> {
    if (repositoryIds.length === 0 || shas.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([run.headSha, suite.appId, run.name], runColumns)
      .from(run)
      .innerJoin(suite, eq(suite.id, run.suiteId))
      .innerJoin(schema.app, eq(schema.app.id, suite.appId))
      .where(
        and(
          inArray(run.repositoryId, repositoryIds),
          inArray(run.headSha, shas),
        ),
      )
      .orderBy(
        asc(run.headSha),
        asc(suite.appId),
        asc(run.name),
        sql`array_position(${sql.param(repositoryIds)}::text[], ${run.repositoryId})`,
        ...newestFirst,
      );
    const bySha = new Map<string, CheckRunDTO[]>();
    for (const row of rows)
      bySha.set(row.headSha, [...(bySha.get(row.headSha) ?? []), row]);
    return bySha;
  }

  private async pageRuns(scope: SQL, query: RunsQuery) {
    const where = and(
      scope,
      query.checkName === undefined ? undefined : eq(run.name, query.checkName),
      query.status === undefined ? undefined : eq(run.status, query.status),
      query.appId === undefined
        ? undefined
        : eq(schema.app.numericId, query.appId),
    );
    const latest = this.db
      .selectDistinctOn([suite.appId, run.name], { id: run.id })
      .from(run)
      .innerJoin(suite, eq(suite.id, run.suiteId))
      .innerJoin(schema.app, eq(schema.app.id, suite.appId))
      .where(where)
      .orderBy(asc(suite.appId), asc(run.name), ...newestFirst);
    const filtered =
      query.filter === 'latest' ? and(where, inArray(run.id, latest)) : where;
    const [runs, [total]] = await Promise.all([
      this.selectRuns()
        .where(filtered)
        .orderBy(...newestFirst)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(run)
        .innerJoin(suite, eq(suite.id, run.suiteId))
        .innerJoin(schema.app, eq(schema.app.id, suite.appId))
        .where(filtered),
    ]);
    return { runs, total: total?.total ?? 0 };
  }

  private async writable(caller: ChecksCaller) {
    const { installation } = caller;
    if (!installation) throw new ChecksNeedInstallationError();
    const repository = await this.access.authorize({
      ...caller,
      operation: 'write',
    });
    return { repository, installation };
  }

  private readable(target: Reader) {
    return this.access.authorize({ ...target, operation: 'read' });
  }

  private async assertHolds(
    repository: { id: string; defaultBranch: string | null },
    sha: string,
  ) {
    if (
      !/^[0-9a-f]{40}$/.test(sha) ||
      !(await this.commitHolder.holds(repository, sha))
    )
      throw new InvalidStatusShaError(sha);
  }

  private async ensureSuite(
    tx: Executor,
    {
      repositoryId,
      headSha,
      installation,
    }: {
      repositoryId: string;
      headSha: string;
      installation: { installationId: string; appId: string };
    },
  ) {
    await tx
      .insert(suite)
      .values({
        repositoryId,
        headSha,
        appId: installation.appId,
        installationId: installation.installationId,
      })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ id: suite.id })
      .from(suite)
      .where(
        and(
          eq(suite.repositoryId, repositoryId),
          eq(suite.headSha, headSha),
          eq(suite.appId, installation.appId),
        ),
      );
    return row.id;
  }

  private async appendAnnotations(
    tx: Executor,
    runId: string,
    annotations: CheckAnnotationInput[] | undefined,
  ) {
    if (!annotations?.length) return;
    const [existing] = await tx
      .select({ count: count() })
      .from(schema.checkAnnotation)
      .where(eq(schema.checkAnnotation.runId, runId));
    if ((existing?.count ?? 0) + annotations.length > MAX_ANNOTATIONS_PER_RUN)
      throw new TooManyAnnotationsError();
    await tx
      .insert(schema.checkAnnotation)
      .values(annotations.map((annotation) => ({ runId, ...annotation })));
  }

  /** Stores the suite's state from its runs, and tells subscribers each time it moves into `completed`. */
  private async recomputeSuite(tx: Executor, suiteId: string, actorId: string) {
    const [before] = await tx
      .select({ status: suite.status, repositoryId: suite.repositoryId })
      .from(suite)
      .where(eq(suite.id, suiteId))
      .for('update');
    const runs = await tx
      .select({
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        createdAt: run.createdAt,
        numericId: run.numericId,
      })
      .from(run)
      .where(eq(run.suiteId, suiteId));
    const next = suiteState(runs);
    await tx
      .update(suite)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(suite.id, suiteId));
    if (next.status === 'completed' && before.status !== 'completed')
      await publishEvent(tx, {
        type: 'check_suite.completed',
        repositoryId: before.repositoryId,
        actorId,
        payload: { checkSuiteId: suiteId },
      });
  }

  private async appNumericId(appId: string) {
    const [row] = await this.db
      .select({ numericId: schema.app.numericId })
      .from(schema.app)
      .where(eq(schema.app.id, appId));
    return row.numericId;
  }

  private selectRuns() {
    return this.db
      .select(runColumns)
      .from(run)
      .innerJoin(suite, eq(suite.id, run.suiteId))
      .innerJoin(schema.app, eq(schema.app.id, suite.appId))
      .$dynamic();
  }

  private async runById(repositoryId: string, runId: string) {
    const [row] = await this.selectRuns().where(
      and(eq(run.id, runId), eq(run.repositoryId, repositoryId)),
    );
    if (!row) throw new CheckRunNotFoundError();
    return row;
  }

  private async suiteById(repositoryId: string, suiteId: string) {
    const [row] = await this.db
      .select(suiteColumns)
      .from(suite)
      .innerJoin(schema.app, eq(schema.app.id, suite.appId))
      .where(and(eq(suite.id, suiteId), eq(suite.repositoryId, repositoryId)));
    if (!row) throw new CheckSuiteNotFoundError();
    return row;
  }
}
