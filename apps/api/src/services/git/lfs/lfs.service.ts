import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../../database/database.module.js';
import {
  LFS_OID,
  lfsEndpoint,
  lfsObjectKey,
  lfsUploadKey,
} from '../../../lib/git/lfs/lfs-objects.js';
import { signLfsToken } from '../../../lib/git/lfs/lfs-token.js';
import {
  InvalidLfsOidError,
  LfsObjectMismatchError,
  LfsObjectNotFoundError,
  LfsObjectTooLargeError,
  LfsUploadInProgressError,
} from '../../../lib/git/lfs/lfs.errors.js';
import type { Repository } from '../../../lib/repositories/access/repository-access.js';
import type { Executor } from '../../../lib/db/executor.js';
import { PUT_OBJECT_MAX_BYTES } from '../../../lib/s3/s3.limits.js';
import { RESERVATION_TTL } from '../../../lib/storage/reservation.js';
import {
  storageAccountOf,
  billedKindOf,
} from '../../../lib/storage/storage-account.js';
import { ContentLengthRequiredError } from '../../../lib/storage/storage.errors.js';
import { S3Service } from '../../s3/s3.service.js';
import { StorageQuotaService } from '../../storage/storage-quota.service.js';

type LfsObject = { oid: string; size: number };

/** Git LFS objects, one copy per repository under `lfs/<repositoryId>/`. Bytes stream through the API both ways, never straight to the bucket (0025). */
/** LFS objects whose upload into the repository finished. */
function uploadedIn(repositoryId: string) {
  return and(
    eq(schema.lfsObject.repositoryId, repositoryId),
    isNotNull(schema.lfsObject.uploadedAt),
  );
}

@Injectable()
export class LfsService {
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly s3: S3Service,
    private readonly quota: StorageQuotaService,
    config: ConfigService,
  ) {
    // The clone URL's origin: LFS objects are served next to the git routes.
    this.baseUrl = config.getOrThrow<string>('BETTER_AUTH_URL');
    this.secret = config.getOrThrow<string>('BETTER_AUTH_SECRET');
  }

  /** What `git-lfs-authenticate` prints over SSH: the HTTPS endpoint, and a token good for an hour on this repository alone. */
  authenticate({
    repositoryId,
    path,
    userId,
    operation,
  }: {
    repositoryId: string;
    path: string;
    userId: string | null;
    operation: 'download' | 'upload';
  }) {
    const expiresIn = 3600;
    const token =
      userId &&
      signLfsToken(this.secret, {
        userId,
        repositoryId,
        operation,
        expiresAt: Date.now() + expiresIn * 1000,
      });
    return {
      href: lfsEndpoint(this.baseUrl, path),
      header: token ? { Authorization: `Bearer ${token}` } : {},
      expires_in: expiresIn,
    };
  }

  /** Answers a batch request in the `basic` transfer: where to send each object the repository lacks, or where to fetch each it holds. Actions carry the request's own credentials, so the client needs no second lookup. */
  async batch({
    repositoryId,
    path,
    operation,
    objects,
    authorization,
  }: {
    repositoryId: string;
    /** `owner/repo`, as the client's remote spells it. */
    path: string;
    operation: 'download' | 'upload';
    objects: LfsObject[];
    authorization: string | undefined;
  }) {
    const stored = new Map(
      (
        await this.db
          .select({ oid: schema.lfsObject.oid, size: schema.lfsObject.size })
          .from(schema.lfsObject)
          .where(
            and(
              uploadedIn(repositoryId),
              inArray(
                schema.lfsObject.oid,
                objects.map(({ oid }) => oid),
              ),
            ),
          )
      ).map(({ oid, size }) => [oid, size]),
    );
    const header = authorization ? { Authorization: authorization } : {};

    return {
      transfer: 'basic',
      hash_algo: 'sha256',
      objects: objects.map(({ oid, size }) => {
        const href = `${lfsEndpoint(this.baseUrl, path)}/objects/${oid}`;
        const storedSize = stored.get(oid);
        if (operation === 'download') {
          return storedSize === undefined
            ? {
                oid,
                size,
                error: { code: 404, message: 'Object does not exist' },
              }
            : {
                oid,
                size: storedSize,
                actions: { download: { href, header } },
              };
        }
        if (storedSize !== undefined) return { oid, size };
        if (size > PUT_OBJECT_MAX_BYTES) {
          const { message } = new LfsObjectTooLargeError(PUT_OBJECT_MAX_BYTES);
          return { oid, size, error: { code: 422, message } };
        }
        return { oid, size, actions: { upload: { href, header } } };
      }),
    };
  }

  /** Streams one object to a staging key of its own, hashing it on the way, and copies it to the object's key only if the bytes hash to `oid`. Until then its row is a reservation against the account's quota. */
  async upload({
    repository,
    oid,
    contentLength,
    body,
  }: {
    repository: Repository;
    oid: string;
    contentLength: string | undefined;
    body: Readable;
  }) {
    // The oid becomes an object key.
    if (!LFS_OID.test(oid)) throw new InvalidLfsOidError(oid);
    const size = Number(contentLength);
    if (!contentLength || !Number.isSafeInteger(size) || size < 0) {
      throw new ContentLengthRequiredError();
    }
    if (size > PUT_OBJECT_MAX_BYTES) {
      throw new LfsObjectTooLargeError(PUT_OBJECT_MAX_BYTES);
    }
    const row = and(
      eq(schema.lfsObject.repositoryId, repository.id),
      eq(schema.lfsObject.oid, oid),
    );

    const [existing] = await this.db
      .select({ oid: schema.lfsObject.oid })
      .from(schema.lfsObject)
      .where(and(row, isNotNull(schema.lfsObject.uploadedAt)));
    if (existing) return;

    const uploadId = randomUUID();
    const mine = and(row, eq(schema.lfsObject.uploadId, uploadId));
    await this.quota.reserve(
      storageAccountOf(repository),
      billedKindOf(repository, 'lfs'),
      size,
      async (tx) => {
        // An upload that died with its process leaves a reservation behind; once it has lapsed it must not hold the oid forever.
        await tx
          .delete(schema.lfsObject)
          .where(
            and(
              row,
              isNull(schema.lfsObject.uploadedAt),
              lt(schema.lfsObject.createdAt, sql`now() - ${RESERVATION_TTL}`),
            ),
          );
        const [reserved] = await tx
          .insert(schema.lfsObject)
          .values({ repositoryId: repository.id, oid, size, uploadId })
          .onConflictDoNothing()
          .returning({ oid: schema.lfsObject.oid });
        if (!reserved) throw new LfsUploadInProgressError(oid);
      },
    );

    // Bytes that never verified must not reach the object's key, where another upload of the same oid may already have stored the real ones.
    const staging = lfsUploadKey(repository.id, uploadId);
    const hash = createHash('sha256');
    // A listener beside the upload's own reader, not a transform in front of it: `putStream` has to see the request's errors to abort.
    body.on('data', (chunk: Buffer) => hash.update(chunk));
    try {
      await this.s3.putStream({
        Key: staging,
        Body: body,
        ContentLength: size,
        ContentType: 'application/octet-stream',
      });
      const actual = hash.digest('hex');
      if (actual !== oid) throw new LfsObjectMismatchError(oid, actual);
      // Verified bytes are the same bytes whoever wrote them, so overwriting another upload's copy loses nothing.
      await this.s3.copyObject({
        Bucket: this.s3.bucket,
        Key: lfsObjectKey(repository.id, oid),
        CopySource: `${this.s3.bucket}/${staging}`,
      });
    } catch (error) {
      await this.db.delete(schema.lfsObject).where(mine);
      throw error;
    } finally {
      await this.s3.deleteObject({ Bucket: this.s3.bucket, Key: staging });
    }

    const [uploaded] = await this.db
      .update(schema.lfsObject)
      .set({ uploadedAt: new Date() })
      .where(mine)
      .returning({ oid: schema.lfsObject.oid });
    // The repository was deleted meanwhile, or this reservation lapsed and another upload took the oid. Either way the stored bytes are not this upload's to remove.
    if (!uploaded) throw new LfsUploadInProgressError(oid);
  }

  /** The size of an object the repository holds, or null. */
  async find(repositoryId: string, oid: string) {
    const [object] = await this.db
      .select({ size: schema.lfsObject.size })
      .from(schema.lfsObject)
      .where(and(uploadedIn(repositoryId), eq(schema.lfsObject.oid, oid)));
    return object ?? null;
  }

  async download(repositoryId: string, oid: string) {
    const object = await this.find(repositoryId, oid);
    if (!object) throw new LfsObjectNotFoundError();

    const { Body } = await this.s3.getObject({
      Bucket: this.s3.bucket,
      Key: lfsObjectKey(repositoryId, oid),
    });
    if (!Body) throw new LfsObjectNotFoundError();
    return { size: object.size, stream: Body as Readable };
  }

  /** What a fork copies, read before its reservation so the fork is billed for exactly what it copies. */
  objectsOf(repositoryId: string): Promise<LfsObject[]> {
    return this.db
      .select({ oid: schema.lfsObject.oid, size: schema.lfsObject.size })
      .from(schema.lfsObject)
      .where(uploadedIn(repositoryId));
  }

  /** Of `oids`, the objects `fromRepositoryId` holds and `toRepositoryId` does not. */
  missingFrom(
    toRepositoryId: string,
    fromRepositoryId: string,
    oids: string[],
  ): Promise<LfsObject[]> {
    if (oids.length === 0) return Promise.resolve([]);
    const target = alias(schema.lfsObject, 'target');
    return this.db
      .select({ oid: schema.lfsObject.oid, size: schema.lfsObject.size })
      .from(schema.lfsObject)
      .where(
        and(
          uploadedIn(fromRepositoryId),
          inArray(schema.lfsObject.oid, oids),

          notExists(
            this.db
              .select({ oid: target.oid })
              .from(target)
              .where(
                and(
                  eq(target.repositoryId, toRepositoryId),
                  eq(target.oid, schema.lfsObject.oid),
                ),
              ),
          ),
        ),
      );
  }

  /** Copies the bytes of `objects` server side. Their rows are written apart, with {@link record}, in the transaction that bills them. */
  async copy(
    objects: LfsObject[],
    fromRepositoryId: string,
    toRepositoryId: string,
  ) {
    for (const { oid } of objects) {
      await this.s3.copyObject({
        Bucket: this.s3.bucket,
        Key: lfsObjectKey(toRepositoryId, oid),
        CopySource: `${this.s3.bucket}/${lfsObjectKey(fromRepositoryId, oid)}`,
      });
    }
  }

  async record(tx: Executor, objects: LfsObject[], repositoryId: string) {
    if (objects.length === 0) return;
    await tx
      .insert(schema.lfsObject)
      .values(
        objects.map(({ oid, size }) => ({
          repositoryId,
          oid,
          size,
          uploadedAt: new Date(),
        })),
      )
      .onConflictDoNothing();
  }

  /** An object's bytes, for a page that renders the file. */
  async read(repositoryId: string, oid: string) {
    const { Body } = await this.s3.getObject({
      Bucket: this.s3.bucket,
      Key: lfsObjectKey(repositoryId, oid),
    });
    if (!Body) throw new LfsObjectNotFoundError();
    return Buffer.from(await Body.transformToByteArray());
  }

  /** Every object of a repository, removed before its row takes theirs with it. */
  remove(repositoryId: string) {
    return this.s3.deleteUnder(lfsObjectKey(repositoryId));
  }
}
