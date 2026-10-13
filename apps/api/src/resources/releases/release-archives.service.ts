import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  ARCHIVE_FORMATS,
  ARCHIVE_MEDIA_TYPES,
  type ArchiveFormat,
  archiveName,
  streamArchive,
} from '../../lib/git/archive/archive.js';
import { resolveCommit } from '../../lib/git/tree/resolve-ref.js';
import { releaseSourceKey } from '../../lib/releases/release-assets.js';
import type { AuthorizedRepository } from '../../lib/repositories/access/repository-access.js';
import { withTempDir } from '../../lib/temp-dir.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { S3Service } from '../../services/s3/s3.service.js';

type Release = { id: string; tagName: string; sourceCommitSha: string | null };

// Building or counting an archive is not an edit, so `updatedAt` keeps saying when someone last changed the release.
const untouched = { updatedAt: sql`${schema.release.updatedAt}` };

/** A release's source archives, built once per commit its tag points at and kept in object storage, so a download streams stored bytes and the release page can show their size. */
@Injectable()
export class ReleaseArchivesService {
  private readonly logger = new Logger(ReleaseArchivesService.name);
  /** Builds under way, by release and commit, so downloads that find the same archive missing share one build. */
  private readonly building = new Map<string, Promise<void>>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly materializer: RepositoryMaterializerService,
    private readonly s3: S3Service,
  ) {}

  /** Its caller does not wait: an archive of a large tree takes a while, and a download that finds none builds it anyway. The promise never rejects. */
  async buildInBackground(repository: AuthorizedRepository, release: Release) {
    try {
      const commit = await resolveCommit(
        await this.materializer.open(repository),
        `refs/tags/${release.tagName}`,
      );
      // a deleted tag has no source to archive
      if (commit) await this.build(repository, release, commit);
    } catch (error) {
      this.logger.warn(
        `Source archives for release ${release.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The release whose source archives a request for `tagName` serves, or null when it has none the viewer may see. */
  async forTag(repository: AuthorizedRepository, tagName: string) {
    const [release] = await this.db
      .select({
        id: schema.release.id,
        tagName: schema.release.tagName,
        sourceCommitSha: schema.release.sourceCommitSha,
      })
      .from(schema.release)
      .where(
        and(
          eq(schema.release.repositoryId, repository.id),
          eq(schema.release.tagName, tagName),
          atLeast(repository.viewerRole, 'write')
            ? undefined
            : eq(schema.release.isDraft, false),
        ),
      );
    return release ?? null;
  }

  /** Streams the stored archive, rebuilding it first from `commit` when the tag has moved since it was built. The download counts once the last byte is read, so an abandoned one does not. */
  async open(
    repository: AuthorizedRepository,
    release: Release,
    commit: string,
    format: ArchiveFormat,
  ): Promise<{ stream: Readable; size?: number }> {
    if (release.sourceCommitSha !== commit) {
      await this.build(repository, release, commit);
    }

    const object = await this.s3.getObject({
      Bucket: this.s3.bucket,
      Key: releaseSourceKey(repository.id, release.id, format),
    });
    const stream = object.Body as Readable;
    stream.once('end', () => {
      this.db
        .update(schema.release)
        .set({
          ...(format === 'zip'
            ? {
                zipballDownloadCount: sql`${schema.release.zipballDownloadCount} + 1`,
              }
            : {
                tarballDownloadCount: sql`${schema.release.tarballDownloadCount} + 1`,
              }),
          ...untouched,
        })
        .where(eq(schema.release.id, release.id))
        .catch((error: unknown) =>
          this.logger.warn(
            `Download of release ${release.id} went uncounted: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    });
    return { stream, size: object.ContentLength };
  }

  private build(
    repository: AuthorizedRepository,
    release: Release,
    commit: string,
  ) {
    const key = `${release.id}:${commit}`;
    const pending =
      this.building.get(key) ??
      this.store(repository, release, commit).finally(() =>
        this.building.delete(key),
      );
    this.building.set(key, pending);
    return pending;
  }

  /** Each archive is spooled to disk first: an upload needs its length before the first byte, and git only knows it at the last. */
  private async store(
    repository: AuthorizedRepository,
    release: Release,
    commit: string,
  ) {
    const directory = await this.materializer.open(repository);
    const sizes = await withTempDir('ghost-archive-', async (scratch) => {
      const built: Partial<Record<ArchiveFormat, number>> = {};
      for (const format of ARCHIVE_FORMATS) {
        const file = path.join(scratch, `source.${format}`);
        await pipeline(
          streamArchive({
            gitDir: directory,
            commit,
            format,
            prefix: archiveName(repository.slug, release.tagName),
          }),
          createWriteStream(file),
        );
        const { size } = await stat(file);
        await this.s3.putStream({
          Key: releaseSourceKey(repository.id, release.id, format),
          Body: createReadStream(file),
          ContentLength: size,
          ContentType: ARCHIVE_MEDIA_TYPES[format],
        });
        built[format] = size;
      }
      return built;
    });

    const [stored] = await this.db
      .update(schema.release)
      .set({
        sourceCommitSha: commit,
        zipballSize: sizes.zip,
        tarballSize: sizes['tar.gz'],
        ...untouched,
      })
      .where(eq(schema.release.id, release.id))
      .returning({ id: schema.release.id });
    // the release was deleted while the archives were being built, and its prefix was emptied before they landed
    if (!stored) {
      await Promise.all(
        ARCHIVE_FORMATS.map((format) =>
          this.s3.deleteObject({
            Bucket: this.s3.bucket,
            Key: releaseSourceKey(repository.id, release.id, format),
          }),
        ),
      );
    }
  }
}
