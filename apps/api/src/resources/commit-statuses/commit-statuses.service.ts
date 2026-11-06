import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, max, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { currentViaAppId, viaAppOf } from '../../lib/apps/via-app.js';
import {
  combinedState,
  DEFAULT_STATUS_CONTEXT,
  MAX_STATUSES_PER_CONTEXT,
} from '../../lib/commit-statuses/commit-statuses.js';
import {
  InvalidStatusShaError,
  TooManyStatusesError,
} from '../../lib/commit-statuses/commit-statuses.errors.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import { publishEvent } from '../../lib/events/events.js';
import type { RefFacts } from '../../lib/rulesets/rulesets.types.js';
import { CommitHolderService } from '../../services/git/commit-holder/commit-holder.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import type {
  CombinedCommitStatusDTO,
  CommitStatusDTO,
  CreateCommitStatusRequestDTO,
} from './dto/commit-status.dto.js';

type RepositoryRef = { username: string; repo: string; requesterId?: string };

const statusColumns = {
  id: schema.commitStatus.id,
  state: schema.commitStatus.state,
  context: schema.commitStatus.context,
  description: schema.commitStatus.description,
  targetUrl: schema.commitStatus.targetUrl,
  createdAt: isoTimestamp(schema.commitStatus.createdAt),
  viaApp: viaAppOf(schema.commitStatus.viaAppId),
  creator: sql<
    CommitStatusDTO['creator']
  >`case when ${schema.user.id} is null then null else json_build_object('username', coalesce(${schema.user.username}, ''), 'image', ${schema.user.image}) end`,
};

/** Newest first; the numeric id breaks ties between rows written in the same instant. */
const newestFirst = [
  desc(schema.commitStatus.createdAt),
  desc(schema.commitStatus.numericId),
];

const SUGGESTED_CONTEXTS = 50;

@Injectable()
export class CommitStatusesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly commitHolder: CommitHolderService,
  ) {}

  async create({
    sha,
    body,
    ...target
  }: RepositoryRef & {
    requesterId: string;
    /** The installation whose token posted it, if one did. */
    installationId?: string;
    sha: string;
    body: CreateCommitStatusRequestDTO;
  }): Promise<CommitStatusDTO> {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new InvalidStatusShaError(sha);
    if (!(await this.commitHolder.holds(repository, sha))) {
      throw new InvalidStatusShaError(sha);
    }

    const context = body.context ?? DEFAULT_STATUS_CONTEXT;
    const id = await this.db.transaction(async (tx) => {
      // ponytail: two concurrent creates can both pass at 999 and land at 1001; a per-context lock if the cap must be exact.
      const [existing] = await tx
        .select({ count: count() })
        .from(schema.commitStatus)
        .where(
          and(
            eq(schema.commitStatus.repositoryId, repository.id),
            eq(schema.commitStatus.sha, sha),
            eq(schema.commitStatus.context, context),
          ),
        );
      if ((existing?.count ?? 0) >= MAX_STATUSES_PER_CONTEXT) {
        throw new TooManyStatusesError(sha, context);
      }

      const [row] = await tx
        .insert(schema.commitStatus)
        .values({
          repositoryId: repository.id,
          sha,
          state: body.state,
          context,
          description: body.description ?? null,
          targetUrl: body.targetUrl ?? null,
          creatorId: target.requesterId,
          installationId: target.installationId ?? null,
          viaAppId: currentViaAppId(),
        })
        .returning({ id: schema.commitStatus.id });
      await publishEvent(tx, {
        type: 'commit_status.created',
        repositoryId: repository.id,
        actorId: target.requesterId,
        payload: { statusId: row.id },
      });
      return row.id;
    });

    const [status] = await this.select().where(eq(schema.commitStatus.id, id));
    return status;
  }

  /** The contexts this repository's statuses and check runs have named, most recent first, for the ruleset form to suggest as required checks. Writers only, as the form is theirs to fill. */
  async contexts(target: RepositoryRef & { requesterId: string }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });
    const { rows } = await this.db.execute<{ context: string }>(sql`
      select context from (
        select ${schema.commitStatus.context} as context, max(${schema.commitStatus.createdAt}) as at from ${schema.commitStatus} where ${schema.commitStatus.repositoryId} = ${repository.id} group by 1
        union all
        select ${schema.checkRun.name}, max(${schema.checkRun.createdAt}) from ${schema.checkRun} where ${schema.checkRun.repositoryId} = ${repository.id} group by 1
      ) seen group by context order by max(at) desc limit ${SUGGESTED_CONTEXTS}`);
    return { contexts: rows.map(({ context }) => context) };
  }

  async combined({
    ref,
    ...target
  }: RepositoryRef & { ref: string }): Promise<CombinedCommitStatusDTO> {
    const { repository, sha } = await this.resolve(target, ref);
    return (
      (await this.combinedFor([repository.id], [sha])).get(sha) ?? {
        sha,
        state: 'pending',
        totalCount: 0,
        statuses: [],
      }
    );
  }

  /** Every status on the commit `ref` names, newest first, as offset pages with the total. */
  async pageStatuses({
    ref,
    offset,
    limit,
    ...target
  }: RepositoryRef & { ref: string; offset: number; limit: number }): Promise<{
    sha: string;
    statuses: CommitStatusDTO[];
    total: number;
  }> {
    const { repository, sha } = await this.resolve(target, ref);
    const where = and(
      eq(schema.commitStatus.repositoryId, repository.id),
      eq(schema.commitStatus.sha, sha),
    );
    const [statuses, [total]] = await Promise.all([
      this.select()
        .where(where)
        .orderBy(...newestFirst)
        .limit(limit)
        // ponytail: OFFSET scans the rows it skips; at most 1000 per context keeps that small.
        .offset(offset),
      this.db.select({ total: count() }).from(schema.commitStatus).where(where),
    ]);
    return { sha, statuses, total: total?.total ?? 0 };
  }

  /** The combined status of each sha across `repositoryIds`: a context posted in several takes the first repository's newest, so a fork cannot override the base's checks. Callers pass repositories they already authorized. A sha without statuses is absent. */
  async combinedFor(
    repositoryIds: string[],
    shas: string[],
  ): Promise<Map<string, CombinedCommitStatusDTO>> {
    if (repositoryIds.length === 0 || shas.length === 0) return new Map();

    const rows = await this.db
      .selectDistinctOn(
        [schema.commitStatus.sha, schema.commitStatus.context],
        {
          sha: schema.commitStatus.sha,
          ...statusColumns,
        },
      )
      .from(schema.commitStatus)
      .leftJoin(schema.user, eq(schema.user.id, schema.commitStatus.creatorId))
      .where(
        and(
          inArray(schema.commitStatus.repositoryId, repositoryIds),
          inArray(schema.commitStatus.sha, shas),
        ),
      )
      .orderBy(
        asc(schema.commitStatus.sha),
        asc(schema.commitStatus.context),
        sql`array_position(${sql.param(repositoryIds)}::text[], ${schema.commitStatus.repositoryId})`,
        ...newestFirst,
      );

    const bySha = new Map<string, CommitStatusDTO[]>();
    for (const { sha, ...status } of rows) {
      const statuses = bySha.get(sha) ?? [];
      statuses.push(status);
      bySha.set(sha, statuses);
    }
    return new Map(
      [...bySha].map(([sha, statuses]) => [
        sha,
        {
          sha,
          state: combinedState(statuses.map((status) => status.state)),
          totalCount: statuses.length,
          statuses,
        },
      ]),
    );
  }

  /** One status by id with its repository, unauthorized: callers check the viewer may read that repository. */
  async findById(id: string) {
    const [status] = await this.db
      .select({
        repositoryId: schema.commitStatus.repositoryId,
        ...statusColumns,
      })
      .from(schema.commitStatus)
      .leftJoin(schema.user, eq(schema.user.id, schema.commitStatus.creatorId))
      .where(eq(schema.commitStatus.id, id));
    return status ?? null;
  }

  private async resolve(target: RepositoryRef, ref: string) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'read',
    });
    return {
      repository,
      sha: await this.commitHolder.commitOf(repository, ref),
    };
  }

  private select() {
    return this.db
      .select(statusColumns)
      .from(schema.commitStatus)
      .leftJoin(schema.user, eq(schema.user.id, schema.commitStatus.creatorId))
      .$dynamic();
  }
}
