import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
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
import { listBranches } from '../../lib/git/refs/list-refs.js';
import { listTags } from '../../lib/git/tags/list-tags.js';
import {
  resolveCommit,
  resolveTargetCommit,
} from '../../lib/git/tree/resolve-ref.js';
import { CommitNotFoundError } from '../../lib/repositories/repositories.errors.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
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
  creator: sql<
    CommitStatusDTO['creator']
  >`case when ${schema.user.id} is null then null else json_build_object('username', coalesce(${schema.user.username}, ''), 'image', ${schema.user.image}) end`,
};

/** Newest first; the numeric id breaks ties between rows written in the same instant. */
const newestFirst = [
  desc(schema.commitStatus.createdAt),
  desc(schema.commitStatus.numericId),
];

@Injectable()
export class CommitStatusesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly materializer: RepositoryMaterializerService,
  ) {}

  async create({
    sha,
    body,
    ...target
  }: RepositoryRef & {
    requesterId: string;
    sha: string;
    body: CreateCommitStatusRequestDTO;
  }): Promise<CommitStatusDTO> {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new InvalidStatusShaError(sha);
    if (!(await this.holdsCommit(repository, sha))) {
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

  /** Whether `sha` is a commit of the repository, or of a fork with a pull request open into it: a fork's head lives in the fork's objects, and the base's CI reports on it here. */
  private async holdsCommit(
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

  private async resolve(target: RepositoryRef, ref: string) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'read',
    });
    const directory = await this.materializer.open(repository);
    const sha = await resolveTargetCommit({
      gitDir: directory,
      defaultBranch: repository.defaultBranch,
      branches: await listBranches(directory),
      tags: await listTags(directory),
      requested: ref,
    });
    if (!sha) throw new CommitNotFoundError(ref);
    return { repository, sha };
  }

  private select() {
    return this.db
      .select(statusColumns)
      .from(schema.commitStatus)
      .leftJoin(schema.user, eq(schema.user.id, schema.commitStatus.creatorId))
      .$dynamic();
  }
}
