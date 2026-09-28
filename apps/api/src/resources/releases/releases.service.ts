import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { packRange } from '../../lib/git/merge/merge.js';
import { fileBody } from '../../lib/git/protocol/git-request-body.js';
import type {
  AuthorizedRepository,
  RepositoryOperation,
} from '../../lib/git/repository-access/repository-access.js';
import { createTagObject } from '../../lib/git/tags/create-tag.js';
import { isValidRefName } from '../../lib/git/refs/is-valid-ref-name.js';
import { listTags } from '../../lib/git/tags/list-tags.js';
import { resolveTargetCommit } from '../../lib/git/tree/resolve-ref.js';
import { ZERO_OID } from '../../lib/git/wal/wal.types.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { decodeCursor, encodeCursor, isoTimestamp } from '../../utils/index.js';
import { InvalidCursorError } from '../repositories/repositories.errors.js';
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
    private readonly storage: RepositoryStorageService,
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
    const repository = await this.authorize(target, 'read');

    const decoded = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !decoded) throw new InvalidCursorError();
    const pageSize = query.limit ?? DEFAULT_PAGE_SIZE;

    const rows = await this.select(
      repository,
      decoded
        ? or(
            lt(schema.release.createdAt, decoded.date),
            and(
              eq(schema.release.createdAt, decoded.date),
              lt(schema.release.id, decoded.id),
            ),
          )
        : undefined,
    ).limit(pageSize + 1);

    const page = rows.slice(0, pageSize);
    const last = page.at(-1);

    return {
      releases: await this.expand(repository, page),
      nextCursor:
        rows.length > pageSize && last
          ? encodeCursor({ date: new Date(last.createdAt), id: last.id })
          : null,
    };
  }

  async getLatestRelease(target: RepositoryRef) {
    const repository = await this.authorize(target, 'read');
    return this.readOne(
      repository,
      eq(schema.release.id, latestReleaseId(repository.id)),
    );
  }

  async getReleaseByTag({
    tagName,
    ...target
  }: RepositoryRef & { tagName: string }) {
    const repository = await this.authorize(target, 'read');
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
    const repository = await this.authorize(target, 'write');
    if (!(await isValidRefName('tags', body.tagName))) {
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

    const directory = await this.openCache(repository);
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
    // A concurrent create for the same tag loses on the unique index.
    const [created] = await this.db
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
    if (!created) throw new ReleaseAlreadyExistsError(body.tagName);

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
    const repository = await this.authorize(target, 'write');

    const [updated] = await this.db
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
    if (!updated) throw new ReleaseNotFoundError();

    return this.readOne(repository, eq(schema.release.id, updated.id));
  }

  /** The tag stays: deleting a release deletes its notes and its assets. */
  async deleteRelease({
    id,
    ...target
  }: RepositoryRef & { id: string; requesterId: string }) {
    const repository = await this.authorize(target, 'write');

    const [release] = await this.db
      .select({ id: schema.release.id })
      .from(schema.release)
      .where(this.ownRelease(repository, id));
    if (!release) throw new ReleaseNotFoundError();

    // storage first: the rows go with the release, and an object nothing points at could never be found again
    await this.assets.removeAll(repository, release.id);
    await this.db
      .delete(schema.release)
      .where(eq(schema.release.id, release.id));
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

    const scratch = await mkdtemp(path.join(tmpdir(), 'ghost-tag-'));
    try {
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
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
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
      this.openCache(repository).then(listTags),
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

  private async openCache(repository: AuthorizedRepository) {
    const directory = await this.storage.getRepoPath(repository.id);
    await this.materializer.materialize(
      repository.id,
      directory,
      repository.defaultBranch,
    );
    return directory;
  }

  private authorize(
    { username, repo, requesterId }: RepositoryRef,
    operation: RepositoryOperation,
  ) {
    return this.access.authorize({
      username,
      repo,
      actor: requesterId ? { userId: requesterId } : null,
      operation,
    });
  }
}
