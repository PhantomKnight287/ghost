import path from 'node:path';

import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { keyset } from '../../lib/db/keyset.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import { publishEvent } from '../../lib/events/events.js';
import { packRange } from '../../lib/git/merge/merge.js';
import {
  bufferBody,
  fileBody,
} from '../../lib/git/protocol/git-request-body.js';
import { isValidRefName } from '../../lib/git/refs/is-valid-ref-name.js';
import { listBranches, listRefs } from '../../lib/git/refs/list-refs.js';
import { createTagObject } from '../../lib/git/tags/create-tag.js';
import { listTags } from '../../lib/git/tags/list-tags.js';
import { resolveTargetCommit } from '../../lib/git/tree/resolve-ref.js';
import { ZERO_OID } from '../../lib/git/wal/wal.types.js';
import {
  InvalidTagNameError,
  ReleaseAlreadyExistsError,
  ReleaseNotFoundError,
  TagNotFoundError,
  TagTargetNotFoundError,
} from '../../lib/releases/releases.errors.js';
import type { AuthorizedRepository } from '../../lib/repositories/access/repository-access.js';
import { ReleaseStorageQuotaExceededError } from '../../lib/storage/storage.errors.js';
import {
  billedKindOf,
  storageAccountOf,
} from '../../lib/storage/storage-account.js';
import { withTempDir } from '../../lib/temp-dir.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RuleSuitesService } from '../../services/rulesets/rule-suites.service.js';
import { RulesetVerdictsService } from '../../services/rulesets/ruleset-verdicts.service.js';
import { EXISTING_HISTORY } from '../../lib/rulesets/rulesets.types.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { StorageQuotaService } from '../../services/storage/storage-quota.service.js';
import { UsersService } from '../../services/users/users.service.js';
import type {
  CreateReleaseRequestDTO,
  GetReleasesQueryDTO,
  GetReleasesResponseDTO,
  ReleaseDTO,
  UpdateReleaseRequestDTO,
} from './dto/release.dto.js';
import { ReleaseArchivesService } from './release-archives.service.js';
import {
  ReleaseAssetsService,
  releaseAssetColumns,
} from './release-assets.service.js';

/** What an edit can change; `release.edited` is published only when one of these differs afterwards. */
const editableColumns = {
  name: schema.release.name,
  body: schema.release.body,
  isDraft: schema.release.isDraft,
  isPrerelease: schema.release.isPrerelease,
};

const DEFAULT_PAGE_SIZE = 10;

type RepositoryRef = { username: string; repo: string; requesterId?: string };

/** How the GitHub layer orders a page: by creation, or by name ignoring case, which falls back to the tag as a nameless release reads. */
export type ReleaseOrder = {
  field: 'created' | 'name';
  direction: 'asc' | 'desc';
};

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
    private readonly pushTransaction: PushTransactionService,
    private readonly users: UsersService,
    private readonly assets: ReleaseAssetsService,
    private readonly archives: ReleaseArchivesService,
    private readonly quota: StorageQuotaService,
    private readonly verdicts: RulesetVerdictsService,
    private readonly ruleSuites: RuleSuitesService,
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

    const list = keyset({
      cursor: query.cursor,
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      keys: { createdAt: schema.release.createdAt, id: schema.release.id },
    });
    const { page, nextCursor } = list.page(
      await this.select(repository, list.where).limit(list.limit),
    );

    return { releases: await this.expand(repository, page), nextCursor };
  }

  /** Offset pages in any order, with the total, as the GitHub layer pages lists. */
  async pageReleases({
    offset,
    limit,
    order,
    ...target
  }: RepositoryRef & { offset: number; limit: number; order: ReleaseOrder }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'read',
    });
    const sort = order.direction === 'asc' ? asc : desc;
    const [rows, [total]] = await Promise.all([
      this.select(repository, undefined, [
        sort(
          order.field === 'name'
            ? sql`lower(coalesce(${schema.release.name}, ${schema.release.tagName}))`
            : schema.release.createdAt,
        ),
        sort(schema.release.id),
      ])
        .limit(limit)
        // ponytail: OFFSET scans the rows it skips; fine for a repository's releases, keyset if one grows thousands.
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.release)
        .where(this.visible(repository)),
    ]);
    return {
      releases: await this.expand(repository, rows),
      total: total?.total ?? 0,
    };
  }

  async getRelease({ id, ...target }: RepositoryRef & { id: string }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'read',
    });
    return this.readOne(repository, eq(schema.release.id, id));
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
    // Checked before the tag is written. Its source archives bill this account and may carry it past its quota; the next release is the one refused.
    await this.db.transaction((tx) =>
      this.quota.assertRoom(
        storageAccountOf(repository),
        billedKindOf(repository, 'asset'),
        ReleaseStorageQuotaExceededError,
        tx,
      ),
    );

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
    void this.archives.buildInBackground(repository, {
      id: created.id,
      tagName: body.tagName,
      sourceCommitSha: null,
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
        .select(editableColumns)
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
        .returning({ id: schema.release.id, ...editableColumns });
      if (!row) throw new ReleaseNotFoundError();
      const event = {
        repositoryId: repository.id,
        actorId: target.requesterId,
        payload: { releaseId: row.id },
      };
      // GitHub sends `edited` only for a change, so publishing an already published release again is silent.
      const changed = (
        Object.keys(editableColumns) as (keyof typeof editableColumns)[]
      ).some((column) => row[column] !== before[column]);
      if (changed) await publishEvent(tx, { type: 'release.edited', ...event });
      if (before.isDraft && !row.isDraft) {
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

  /** A ref-only entry in the log, pinned to the tag's current target so a push that moved it in between wins. Releases on the tag stay, pointing at nothing. */
  async deleteTag({
    tagName,
    ...target
  }: RepositoryRef & { tagName: string; requesterId: string }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });
    const ref = `refs/tags/${tagName}`;
    // The tag object's own id, not the commit it peels to: that is what the ref holds.
    const directory = await this.materializer.open(repository);
    const oid = (await listRefs(directory)).get(ref);
    if (!oid) throw new TagNotFoundError(tagName);

    const transitions = [
      { ref, oldOid: Buffer.from(oid, 'hex'), newOid: ZERO_OID },
    ];
    const verdict = await this.verdicts.judge({
      repository,
      gitDir: directory,
      userId: target.requesterId,
      write: 'push',
      transitions,
    });
    await this.ruleSuites.attempt(
      { repositoryId: repository.id, actorId: target.requesterId, verdict },
      () =>
        this.pushTransaction.commitPush({
          repoId: repository.id,
          transitions,
          body: bufferBody(Buffer.alloc(0)),
          packOffset: 0,
          actor: { userId: target.requesterId, verdict },
        }),
    );
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
      const transitions = [
        {
          ref: `refs/tags/${name}`,
          oldOid: ZERO_OID,
          newOid: Buffer.from(oid, 'hex'),
        },
      ];
      const verdict = await this.verdicts.judge({
        repository,
        gitDir: directory,
        userId: requesterId,
        write: 'push',
        transitions,
        facts: new Map([[transitions[0].ref, EXISTING_HISTORY]]),
      });
      await this.ruleSuites.attempt(
        { repositoryId: repository.id, actorId: requesterId, verdict },
        () =>
          this.pushTransaction.commitPush({
            repoId: repository.id,
            transitions,
            body: fileBody(pack.path, pack.size),
            packOffset: 0,
            actor: { userId: requesterId, verdict },
          }),
      );
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
      branches: await listBranches(directory),
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

  /** Drafts are left out for anyone who cannot write to the repository. */
  private visible(repository: AuthorizedRepository) {
    return and(
      eq(schema.release.repositoryId, repository.id),
      atLeast(repository.viewerRole, 'write')
        ? undefined
        : eq(schema.release.isDraft, false),
    );
  }

  /** Newest first unless `order` says otherwise. */
  private select(
    repository: AuthorizedRepository,
    where: SQL | undefined,
    order: SQL[] = [desc(schema.release.createdAt), desc(schema.release.id)],
  ) {
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
        sourceCommitSha: schema.release.sourceCommitSha,
        zipballSize: schema.release.zipballSize,
        tarballSize: schema.release.tarballSize,
        zipballDownloadCount: schema.release.zipballDownloadCount,
        tarballDownloadCount: schema.release.tarballDownloadCount,
        publishedAt: isoTimestamp(schema.release.publishedAt),
        createdAt: isoTimestamp(schema.release.createdAt),
        updatedAt: isoTimestamp(schema.release.updatedAt),
      })
      .from(schema.release)
      .leftJoin(schema.user, eq(schema.user.id, schema.release.authorId))
      .where(and(this.visible(repository), where))
      .orderBy(...order);
  }

  /** Commits come from git, not the row: a tag can be moved or deleted by a push at any time. Assets still uploading are left out. */
  private async expand<
    T extends {
      id: string;
      tagName: string;
      sourceCommitSha: string | null;
      zipballSize: number | null;
      tarballSize: number | null;
      zipballDownloadCount: number;
      tarballDownloadCount: number;
    },
  >(repository: AuthorizedRepository, releases: T[]) {
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

    return releases.map(
      ({
        sourceCommitSha,
        zipballSize,
        tarballSize,
        zipballDownloadCount,
        tarballDownloadCount,
        ...release
      }) => {
        const commitSha = shas.get(release.tagName) ?? null;
        // archives built from a commit the tag has since moved off are rebuilt on the next download, and their size is not yet known
        const current = commitSha !== null && sourceCommitSha === commitSha;
        return {
          ...release,
          commitSha,
          source:
            commitSha === null
              ? null
              : {
                  zipball: {
                    size: current ? zipballSize : null,
                    downloadCount: zipballDownloadCount,
                  },
                  tarball: {
                    size: current ? tarballSize : null,
                    downloadCount: tarballDownloadCount,
                  },
                },
          assets: assets
            .filter((asset) => asset.releaseId === release.id)
            .map(({ releaseId: _, ...asset }) => asset),
          viewerCanEdit,
        };
      },
    );
  }
}
