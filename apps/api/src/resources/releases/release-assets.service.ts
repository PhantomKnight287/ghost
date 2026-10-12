import type { Readable } from 'node:stream';

import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt, ne, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import {
  isValidAssetName,
  releaseAssetKey,
} from '../../lib/releases/release-assets.js';
import {
  InvalidAssetNameError,
  ReleaseAssetExistsError,
  ReleaseAssetNotFoundError,
  ReleaseAssetTooLargeError,
  ReleaseNotFoundError,
} from '../../lib/releases/releases.errors.js';
import type { AuthorizedRepository } from '../../lib/repositories/access/repository-access.js';
import { formatByteSize } from '../../lib/storage/byte-size.js';
import { RESERVATION_TTL } from '../../lib/storage/reservation.js';
import { ContentLengthRequiredError } from '../../lib/storage/storage.errors.js';
import {
  billedKindOf,
  storageAccountOf,
} from '../../lib/storage/storage-account.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { S3Service } from '../../services/s3/s3.service.js';
import { StorageQuotaService } from '../../services/storage/storage-quota.service.js';

type RepositoryRef = { username: string; repo: string; requesterId?: string };

export const releaseAssetColumns = {
  id: schema.releaseAsset.id,
  name: schema.releaseAsset.name,
  contentType: schema.releaseAsset.contentType,
  size: schema.releaseAsset.size,
  downloadCount: schema.releaseAsset.downloadCount,
  createdAt: isoTimestamp(schema.releaseAsset.createdAt),
};

/** Files attached to releases. Bytes stream straight from the request to object storage and back, never held in memory. */
@Injectable()
export class ReleaseAssetsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly s3: S3Service,
    private readonly quota: StorageQuotaService,
  ) {}

  /** The row is written first, as a reservation against the owner's quota, and only marked uploaded once every byte is stored. */
  async upload({
    releaseId,
    name,
    label,
    type,
    contentLength,
    body,
    ...target
  }: RepositoryRef & {
    requesterId: string;
    releaseId: string;
    name: string;
    label?: string;
    /** What the file is served as. */
    type: string | undefined;
    contentLength: string | undefined;
    /** The raw request: the caller makes sure no body parser has read it. */
    body: Readable;
  }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });
    const fileName = name.trim();
    if (!isValidAssetName(fileName)) throw new InvalidAssetNameError(name);

    const size = Number(contentLength);
    if (!contentLength || !Number.isSafeInteger(size) || size <= 0) {
      throw new ContentLengthRequiredError();
    }
    if (size > this.quota.maxAssetBytes) {
      throw new ReleaseAssetTooLargeError(
        formatByteSize(this.quota.maxAssetBytes),
      );
    }

    const [release] = await this.db
      .select({ id: schema.release.id })
      .from(schema.release)
      .where(
        and(
          eq(schema.release.id, releaseId),
          eq(schema.release.repositoryId, repository.id),
        ),
      );
    if (!release) throw new ReleaseNotFoundError();

    const asset = await this.quota.reserve(
      storageAccountOf(repository),
      billedKindOf(repository, 'asset'),
      size,
      async (tx) => {
        // An upload that died with its process leaves a reservation behind; once it has lapsed it must not hold the name forever.
        await tx
          .delete(schema.releaseAsset)
          .where(
            and(
              eq(schema.releaseAsset.releaseId, release.id),
              eq(schema.releaseAsset.name, fileName),
              eq(schema.releaseAsset.state, 'uploading'),
              lt(
                schema.releaseAsset.createdAt,
                sql`now() - ${RESERVATION_TTL}`,
              ),
            ),
          );

        const [row] = await tx
          .insert(schema.releaseAsset)
          .values({
            releaseId: release.id,
            repositoryId: repository.id,
            name: fileName,
            label: label?.trim() || null,
            contentType: type || 'application/octet-stream',
            size,
            uploaderId: target.requesterId,
          })
          .onConflictDoNothing()
          .returning({ id: schema.releaseAsset.id });
        if (!row) throw new ReleaseAssetExistsError(fileName);
        return row;
      },
    );

    const key = releaseAssetKey(repository.id, release.id, asset.id);
    try {
      await this.s3.putStream({
        Key: key,
        Body: body,
        ContentLength: size,
        ContentType: 'application/octet-stream',
      });
    } catch (error) {
      await this.db
        .delete(schema.releaseAsset)
        .where(eq(schema.releaseAsset.id, asset.id));
      throw error;
    }

    const [uploaded] = await this.db
      .update(schema.releaseAsset)
      .set({ state: 'uploaded' })
      .where(eq(schema.releaseAsset.id, asset.id))
      .returning(releaseAssetColumns);
    // the release was deleted while the bytes were in flight, taking the row with it
    if (!uploaded) {
      await this.s3.deleteObject({ Bucket: this.s3.bucket, Key: key });
      throw new ReleaseNotFoundError();
    }
    return uploaded;
  }

  /** Counts the download, then streams the bytes. A draft's assets are only for people who can write to the repository. */
  async download({
    asset: wanted,
    ...target
  }: RepositoryRef & {
    asset: { tagName: string; name: string } | { id: string };
  }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'read',
    });

    const [asset] = await this.db
      .update(schema.releaseAsset)
      .set({ downloadCount: sql`${schema.releaseAsset.downloadCount} + 1` })
      .from(schema.release)
      .where(
        and(
          eq(schema.release.id, schema.releaseAsset.releaseId),
          eq(schema.release.repositoryId, repository.id),
          'id' in wanted
            ? eq(schema.releaseAsset.id, wanted.id)
            : and(
                eq(schema.release.tagName, wanted.tagName),
                eq(schema.releaseAsset.name, wanted.name),
              ),
          atLeast(repository.viewerRole, 'write')
            ? undefined
            : eq(schema.release.isDraft, false),
          eq(schema.releaseAsset.state, 'uploaded'),
        ),
      )
      .returning({
        id: schema.releaseAsset.id,
        releaseId: schema.releaseAsset.releaseId,
        name: schema.releaseAsset.name,
        contentType: schema.releaseAsset.contentType,
        size: schema.releaseAsset.size,
      });
    if (!asset) throw new ReleaseAssetNotFoundError();

    const object = await this.s3.getObject({
      Bucket: this.s3.bucket,
      Key: releaseAssetKey(repository.id, asset.releaseId, asset.id),
    });
    if (!object.Body) throw new ReleaseAssetNotFoundError();

    return { ...asset, stream: object.Body as Readable };
  }

  /** Renames an asset or sets its label; an empty label clears it. */
  async update({
    assetId,
    name,
    label,
    ...target
  }: RepositoryRef & {
    requesterId: string;
    assetId: string;
    name?: string;
    label?: string;
  }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });
    const fileName = name?.trim();
    if (fileName !== undefined && !isValidAssetName(fileName))
      throw new InvalidAssetNameError(fileName);
    const mine = and(
      eq(schema.releaseAsset.id, assetId),
      eq(schema.releaseAsset.repositoryId, repository.id),
      eq(schema.releaseAsset.state, 'uploaded'),
    );

    if (fileName !== undefined) {
      const [clash] = await this.db
        .select({ id: schema.releaseAsset.id })
        .from(schema.releaseAsset)
        .where(
          and(
            eq(
              schema.releaseAsset.releaseId,
              this.db
                .select({ releaseId: schema.releaseAsset.releaseId })
                .from(schema.releaseAsset)
                .where(mine),
            ),
            eq(schema.releaseAsset.name, fileName),
            ne(schema.releaseAsset.id, assetId),
          ),
        );
      if (clash) throw new ReleaseAssetExistsError(fileName);
    }

    const [updated] = await this.db
      .update(schema.releaseAsset)
      .set({
        // always set, so an empty edit still finds the row instead of failing to build the query
        updatedAt: new Date(),
        ...(fileName !== undefined && { name: fileName }),
        ...(label !== undefined && { label: label.trim() || null }),
      })
      .where(mine)
      .returning(releaseAssetColumns);
    if (!updated) throw new ReleaseAssetNotFoundError();
    return updated;
  }

  async delete({
    assetId,
    ...target
  }: RepositoryRef & { requesterId: string; assetId: string }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });

    const [asset] = await this.db
      .select({
        id: schema.releaseAsset.id,
        releaseId: schema.releaseAsset.releaseId,
      })
      .from(schema.releaseAsset)
      .where(
        and(
          eq(schema.releaseAsset.id, assetId),
          eq(schema.releaseAsset.repositoryId, repository.id),
        ),
      );
    if (!asset) throw new ReleaseAssetNotFoundError();

    // bytes first: a row left without its object is visible and can be deleted again, an object left without its row would be invisible forever
    await this.s3.deleteObject({
      Bucket: this.s3.bucket,
      Key: releaseAssetKey(repository.id, asset.releaseId, asset.id),
    });
    await this.db
      .delete(schema.releaseAsset)
      .where(eq(schema.releaseAsset.id, asset.id));
  }

  /** Every asset of a release, removed from storage before the release row takes the rows with it. */
  removeAll(repository: AuthorizedRepository, releaseId: string) {
    return this.s3.deleteUnder(releaseAssetKey(repository.id, releaseId));
  }
}
