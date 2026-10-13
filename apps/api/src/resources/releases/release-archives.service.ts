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

/** A release's source archives, built once per commit its tag points at and kept in object storage, so a download streams stored bytes and the release page can show their size. */
@Injectable()
export class ReleaseArchivesService {
  private readonly logger = new Logger(ReleaseArchivesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly materializer: RepositoryMaterializerService,
    private readonly s3: S3Service,
  ) {}

  /** Its caller does not wait: an archive of a large tree takes a while, and a download that finds none builds it anyway. The promise never rejects. */
  buildInBackground(repository: AuthorizedRepository, release: Release) {
    return this.build(repository, release).catch((error: unknown) =>
      this.logger.warn(
        `Source archives for release ${release.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
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

  /** Counts the download, then streams the stored archive, rebuilding it first when the tag has moved since it was built. */
  async open(
    repository: AuthorizedRepository,
    release: Release,
    commit: string,
    format: ArchiveFormat,
  ): Promise<{ stream: Readable; size?: number }> {
    if (release.sourceCommitSha !== commit) {
      await this.build(repository, release);
    }
    await this.db
      .update(schema.release)
      .set(
        format === 'zip'
          ? {
              zipballDownloadCount: sql`${schema.release.zipballDownloadCount} + 1`,
            }
          : {
              tarballDownloadCount: sql`${schema.release.tarballDownloadCount} + 1`,
            },
      )
      .where(eq(schema.release.id, release.id));

    const object = await this.s3.getObject({
      Bucket: this.s3.bucket,
      Key: releaseSourceKey(repository.id, release.id, format),
    });
    return { stream: object.Body as Readable, size: object.ContentLength };
  }

  /** Each archive is spooled to disk first: an upload needs its length before the first byte, and git only knows it at the last. */
  private async build(repository: AuthorizedRepository, release: Release) {
    const directory = await this.materializer.open(repository);
    const commit = await resolveCommit(
      directory,
      `refs/tags/${release.tagName}`,
    );
    // a deleted tag has no source to archive
    if (!commit) return;

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
