import path from 'node:path';
import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { publishEvent } from '../../lib/events/events.js';
import { packRange } from '../../lib/git/merge/merge.js';
import { fileBody } from '../../lib/git/protocol/git-request-body.js';
import type { AuthorizedRepository } from '../../lib/git/repository-access/repository-access.js';
import { createTagObject } from '../../lib/git/tags/create-tag.js';
import { isValidRefName } from '../../lib/git/refs/is-valid-ref-name.js';
import { listTags } from '../../lib/git/tags/list-tags.js';
import { resolveTargetCommit } from '../../lib/git/tree/resolve-ref.js';
import { ZERO_OID } from '../../lib/git/wal/wal.types.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { isoTimestamp } from '../../utils/index.js';
import { encodeCursor, keysetAfter, paginate } from '../../lib/db/keyset.js';
import type {
  CreateReleaseRequestDTO,
  GetReleasesQueryDTO,
  GetReleasesResponseDTO,
  ReleaseDTO,
  UpdateReleaseRequestDTO,
} from './dto/release.dto.js';
import {
  ReleaseAssetsService,
  releaseAssetColumns,
} from './release-assets.service.js';
import {
  InvalidTagNameError,
  ReleaseAlreadyExistsError,
  ReleaseNotFoundError,
  TagTargetNotFoundError,
} from './releases.errors.js';
import { withTempDir } from '../../lib/temp-dir.js';

const DEFAULT_PAGE_SIZE = 10;

type RepositoryRef = { username: string; repo: string; requesterId?: string };

/** Newest published release that is neither a draft nor a prerelease. */
function latestReleaseId(repositoryId: string) {
  return sql`(select ${schema.release.id} from ${schema.release} where ${schema.release.repositoryId} = ${repositoryId} and not ${schema.release.isDraft} and not ${schema.release.isPrerelease} order by ${schema.release.publishedAt} desc, ${schema.release.id} desc limit 1)`;
}

@Injectable()
export class ReleasesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly branches: BranchesService,
    private readonly pushTransaction: PushTransactionService,
    private readonly users: UsersService,
    private readonly assets: ReleaseAssetsService,
  ) {}

  async listReleases({
    query,
    ...target
  }: RepositoryRef & {
    query: GetReleasesQueryDTO;
  }): Promise<GetReleasesResponseDTO> {
    const repository = await this.access.authorize({
      ...target,
      operation: 'read',
    });

    const pageSize = query.limit ?? DEFAULT_PAGE_SIZE;
    const rows = await this.select(
      repository,
      keysetAfter(query.cursor, schema.release.createdAt, schema.release.id),
    ).limit(pageSize + 1);
    const { page, nextCursor } = paginate(rows, pageSize, (row) =>
      encodeCursor({ date: new Date(row.createdAt), id: row.id }),
    );

    return { releases: await this.expand(repository, page), nextCursor };
  }

  async getLatestRelease(target: RepositoryRef) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'read',
    });
    return this.readOne(
      repository,
      eq(schema.release.id, latestReleaseId(repository.id)),
    );
  }

  async getReleaseByTag({
    tagName,
    ...target
  }: RepositoryRef & { tagName: string }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'read',
    });
    return this.readOne(repository, eq(schema.release.tagName, tagName));
  }

  /** A tag that does not exist yet is created first, annotated, through the same commit point a push uses. */
  async createRelease({
    body,
    ...target
  }: RepositoryRef & {
    requesterId: string;
    body: CreateReleaseRequestDTO;
  }): Promise<ReleaseDTO> {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });
    if (!isValidRefName('tags', body.tagName)) {
      throw new InvalidTagNameError(body.tagName);
    }

    const [existing] = await this.db
      .select({ id: schema.release.id })
      .from(schema.release)
      .where(
        and(
          eq(schema.release.repositoryId, repository.id),
          eq(schema.release.tagName, body.tagName),
        ),
      );
    if (existing) throw new ReleaseAlreadyExistsError(body.tagName);

    const directory = await this.materializer.open(repository);
    const tags = await listTags(directory);
    // ponytail: a draft tags its commit straight away; GitHub waits for publishing, which needs the target stored on the row.
    if (!tags.some((tag) => tag.name === body.tagName)) {
      const sha = await this.resolveTarget(
        repository,
        directory,
        tags,
        body.target,
      );
      await this.createTag({
        repository,
        directory,
        sha,
        name: body.tagName,
        message: body.name || body.tagName,
        requesterId: target.requesterId,
      });
    }

    const isDraft = body.isDraft ?? false;
    const created = await this.db.transaction(async (tx) => {
      // A concurrent create for the same tag loses on the unique index.
      const [row] = await tx
        .insert(schema.release)
        .values({
          repositoryId: repository.id,
          tagName: body.tagName,
          name: body.name || null,
          body: body.body || null,
          isDraft,
          isPrerelease: body.isPrerelease ?? false,
          authorId: target.requesterId,
          publishedAt: isDraft ? null : new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: schema.release.id });
      if (!row) throw new ReleaseAlreadyExistsError(body.tagName);
      const event = {
        repositoryId: repository.id,
        actorId: target.requesterId,
        payload: { releaseId: row.id },
      };
      await publishEvent(tx, { type: 'release.created', ...event });
      if (!isDraft) {
        await publishEvent(tx, { type: 'release.published', ...event });
      }
      return row;
    });

    return this.readOne(repository, eq(schema.release.id, created.id));
  }

  async updateRelease({
    id,
    body,
    ...target
  }: RepositoryRef & {
    id: string;
    requesterId: string;
    body: UpdateReleaseRequestDTO;
  }): Promise<ReleaseDTO> {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });

    const updated = await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ isDraft: schema.release.isDraft })
        .from(schema.release)
        .where(this.ownRelease(repository, id))
        .for('update');
      if (!before) throw new ReleaseNotFoundError();

      const [row] = await tx
        .update(schema.release)
        .set({
          // always set, so an empty edit still finds the row instead of failing to build the query
          updatedAt: new Date(),
          ...(body.name !== undefined && { name: body.name || null }),
          ...(body.body !== undefined && { body: body.body || null }),
          ...(body.isPrerelease !== undefined && {
            isPrerelease: body.isPrerelease,
          }),
          ...(body.isDraft !== undefined && { isDraft: body.isDraft }),
          // stamped the first time it is published, and kept through any later unpublishing
          ...(body.isDraft === false && {
            publishedAt: sql`coalesce(${schema.release.publishedAt}, now())`,
          }),
        })
        .where(this.ownRelease(repository, id))
        .returning({ id: schema.release.id });
      if (!row) throw new ReleaseNotFoundError();
      const event = {
        repositoryId: repository.id,
        actorId: target.requesterId,
        payload: { releaseId: row.id },
      };
      await publishEvent(tx, { type: 'release.edited', ...event });
      if (before.isDraft && body.isDraft === false) {
        await publishEvent(tx, { type: 'release.published', ...event });
      }
      return row;
    });

    return this.readOne(repository, eq(schema.release.id, updated.id));
  }

  /** The tag stays: deleting a release deletes its notes and its assets. */
  async deleteRelease({
    id,
    ...target
  }: RepositoryRef & { id: string; requesterId: string }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });

    const [release] = await this.db
      .select({
        id: schema.release.id,
        tagName: schema.release.tagName,
        name: schema.release.name,
      })
      .from(schema.release)
      .where(this.ownRelease(repository, id));
    if (!release) throw new ReleaseNotFoundError();

    // storage first: the rows go with the release, and an object nothing points at could never be found again
    await this.assets.removeAll(repository, release.id);
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.release).where(eq(schema.release.id, release.id));
      await publishEvent(tx, {
        type: 'release.deleted',
        repositoryId: repository.id,
        actorId: target.requesterId,
        payload: { release },
      });
    });
  }

  /** An annotated tag, as `git tag -a` makes, so the tag carries its own date and author rather than borrowing its commit's. Its one object is packed and pushed through `commitPush`. */
  private async createTag({
    repository,
    directory,
    sha,
    name,
    message,
    requesterId,
  }: {
    repository: AuthorizedRepository;
    directory: string;
    sha: string;
    name: string;
    message: string;
    requesterId: string;
  }) {
    const tagger = await this.users.getUserById(requesterId);
    const oid = await createTagObject({
      gitDir: directory,
      sha,
      name,
      message,
      tagger,
    });

    await withTempDir('ghost-tag-', async (scratch) => {
      const pack = await packRange({
        gitDir: directory,
        include: [oid],
        exclude: [sha],
        prefix: path.join(scratch, 'tag'),
      });
      await this.pushTransaction.commitPush({
        repoId: repository.id,
        transitions: [
          {
            ref: `refs/tags/${name}`,
            oldOid: ZERO_OID,
            newOid: Buffer.from(oid, 'hex'),
          },
        ],
        body: fileBody(pack.path, pack.size),
        packOffset: 0,
        pushedBy: requesterId,
      });
    });
  }

  private ownRelease(repository: AuthorizedRepository, id: string) {
    return and(
      eq(schema.release.id, id),
      eq(schema.release.repositoryId, repository.id),
    );
  }

  private async resolveTarget(
    repository: AuthorizedRepository,
    directory: string,
    tags: { name: string; sha: string }[],
    requested: string | undefined,
  ) {
    const name = requested?.trim();
    const sha = await resolveTargetCommit({
      gitDir: directory,
      defaultBranch: repository.defaultBranch,
      branches: await this.branches.getGitBranches(directory),
      tags,
      requested: name,
    });
    if (!sha)
      throw new TagTargetNotFoundError(name ?? repository.defaultBranch ?? '');
    return sha;
  }

  private async readOne(repository: AuthorizedRepository, where: SQL) {
    const [row] = await this.select(repository, where).limit(1);
    if (!row) throw new ReleaseNotFoundError();

    const [release] = await this.expand(repository, [row]);
    return release;
  }

  /** Newest first. Drafts are left out for anyone who cannot write to the repository. */
  private select(repository: AuthorizedRepository, where: SQL | undefined) {
    const canWrite = atLeast(repository.viewerRole, 'write');

    return this.db
      .select({
        id: schema.release.id,
        tagName: schema.release.tagName,
        name: schema.release.name,
        body: schema.release.body,
        isDraft: schema.release.isDraft,
        isPrerelease: schema.release.isPrerelease,
        isLatest: sql<boolean>`coalesce(${schema.release.id} = ${latestReleaseId(repository.id)}, false)`,
        authorUsername: schema.user.username,
        publishedAt: isoTimestamp(schema.release.publishedAt),
        createdAt: isoTimestamp(schema.release.createdAt),
        updatedAt: isoTimestamp(schema.release.updatedAt),
      })
      .from(schema.release)
      .leftJoin(schema.user, eq(schema.user.id, schema.release.authorId))
      .where(
        and(
          eq(schema.release.repositoryId, repository.id),
          canWrite ? undefined : eq(schema.release.isDraft, false),
          where,
        ),
      )
      .orderBy(desc(schema.release.createdAt), desc(schema.release.id));
  }

  /** Commits come from git, not the row: a tag can be moved or deleted by a push at any time. Assets still uploading are left out. */
  private async expand<T extends { id: string; tagName: string }>(
    repository: AuthorizedRepository,
    releases: T[],
  ) {
    if (releases.length === 0) return [];

    const [tags, assets] = await Promise.all([
      this.materializer.open(repository).then(listTags),
      this.db
        .select({
          releaseId: schema.releaseAsset.releaseId,
          ...releaseAssetColumns,
        })
        .from(schema.releaseAsset)
        .where(
          and(
            inArray(
              schema.releaseAsset.releaseId,
              releases.map((release) => release.id),
            ),
            eq(schema.releaseAsset.state, 'uploaded'),
          ),
        )
        .orderBy(asc(schema.releaseAsset.name)),
    ]);
    const shas = new Map(tags.map((tag) => [tag.name, tag.sha]));
    const viewerCanEdit = atLeast(repository.viewerRole, 'write');

    return releases.map((release) => ({
      ...release,
      commitSha: shas.get(release.tagName) ?? null,
      assets: assets
        .filter((asset) => asset.releaseId === release.id)
        .map(({ releaseId: _, ...asset }) => asset),
      viewerCanEdit,
    }));
  }
}
