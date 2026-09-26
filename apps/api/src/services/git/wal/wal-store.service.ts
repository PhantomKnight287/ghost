import { Injectable } from '@nestjs/common';

import type { Readable } from 'node:stream';

import { S3Service } from '../../s3/s3.service.js';
import { isNotFound, statusOf } from '../../../lib/s3/s3.errors.js';
import {
  prefixed,
  type GitRequestBody,
} from '../../../lib/git/protocol/git-request-body.js';
import {
  decodeEntryHeader,
  decodeIndex,
  encodeIndex,
  ENTRY_CONTENT_TYPE,
  ENTRY_HEADER_PROBE_BYTES,
  INDEX_CONTENT_TYPE,
} from '../../../lib/git/wal/wal-codec.js';
import {
  emptyIndex,
  type WalEntryHeader,
  type WalIndex,
} from '../../../lib/git/wal/wal.types.js';
import {
  RepositoryDeletedError,
  WalContentionError,
} from '../../../lib/git/wal/wal.errors.js';

// Each lost CAS is a push that committed in between; only a stream of pushes could outlast this, and the caller retries.
const MAX_TOMBSTONE_ATTEMPTS = 8;

export interface StoredIndex {
  index: WalIndex;
  etag: string;
}

@Injectable()
export class WalStoreService {
  constructor(private readonly s3: S3Service) {}

  indexKey(repoId: string) {
    return `repos/${repoId}/index`;
  }

  entryKey(repoId: string, ulid: string) {
    return `repos/${repoId}/entries/${ulid}.pack`;
  }

  // null when the repository has no index yet.
  async readIndex(repoId: string): Promise<StoredIndex | null> {
    const stored = await this.readStoredIndex(repoId);
    if (stored?.index.deleted) throw new RepositoryDeletedError();
    return stored;
  }

  private async readStoredIndex(repoId: string): Promise<StoredIndex | null> {
    try {
      const response = await this.s3.getObject({
        Bucket: this.s3.bucket,
        Key: this.indexKey(repoId),
      });
      const body = Buffer.from(await response.Body!.transformToByteArray());
      return { index: decodeIndex(body), etag: response.ETag! };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Swaps the index for an empty one flagged deleted, so a push racing the delete loses its CAS and then reads the repository as gone. The tombstone is never removed: a push authorized just before the delete could otherwise recreate the index from nothing. */
  async tombstone(repoId: string) {
    for (let attempt = 0; attempt < MAX_TOMBSTONE_ATTEMPTS; attempt++) {
      const current = await this.readStoredIndex(repoId);
      if (current?.index.deleted) return;

      const next = {
        ...emptyIndex(),
        seq: (current?.index.seq ?? 0) + 1,
        deleted: true,
      };
      if (await this.casIndex(repoId, next, current?.etag ?? null)) return;
    }
    throw new WalContentionError(repoId);
  }

  /** Every entry of the log. Only safe behind a tombstone, which stops new entries from being committed. */
  async purgeEntries(repoId: string) {
    await this.s3.deleteUnder(`repos/${repoId}/entries/`);
  }

  async deleteEntry(repoId: string, ulid: string) {
    await this.s3.deleteObject({
      Bucket: this.s3.bucket,
      Key: this.entryKey(repoId, ulid),
    });
  }

  /** Copies a repository's log to a new id: the packs first, then the index that names them, so a fork is never pointed at objects that have not landed yet. Layers are immutable once written, so this needs no lock. */
  async copyLog(fromRepoId: string, toRepoId: string) {
    const stored = await this.readIndex(fromRepoId);
    if (!stored) return;

    for (const layer of stored.index.layers) {
      await this.s3.copyObject({
        Bucket: this.s3.bucket,
        Key: this.entryKey(toRepoId, layer.ulid),
        CopySource: `${this.s3.bucket}/${this.entryKey(fromRepoId, layer.ulid)}`,
      });
    }

    await this.casIndex(toRepoId, stored.index, null);
  }

  /** The commit point of a push. A null etag means create-if-absent. Returns false when another writer won the race. */
  async casIndex(
    repoId: string,
    next: WalIndex,
    etag: string | null,
  ): Promise<boolean> {
    try {
      await this.s3.putObject({
        Bucket: this.s3.bucket,
        Key: this.indexKey(repoId),
        Body: encodeIndex(next),
        ContentType: INDEX_CONTENT_TYPE,
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
      });
      return true;
    } catch (error) {
      const status = statusOf(error);
      if (status === 412 || status === 409) return false;
      throw error;
    }
  }

  /** ContentLength is mandatory: the body is a stream, so the SDK cannot measure it, and concatenating header and pack in memory is exactly what a large push cannot afford. */
  async putEntry(
    repoId: string,
    ulid: string,
    header: Buffer,
    pack: GitRequestBody,
    packStart = 0,
  ): Promise<void> {
    await this.s3.putObject({
      Bucket: this.s3.bucket,
      Key: this.entryKey(repoId, ulid),
      Body: prefixed(header, pack, packStart),
      ContentLength: header.length + (pack.size - packStart),
      ContentType: ENTRY_CONTENT_TYPE,
    });
  }

  async readEntryHeader(
    repoId: string,
    ulid: string,
  ): Promise<WalEntryHeader | null> {
    try {
      const response = await this.s3.getObject({
        Bucket: this.s3.bucket,
        Key: this.entryKey(repoId, ulid),
        Range: `bytes=0-${ENTRY_HEADER_PROBE_BYTES - 1}`,
      });
      const body = Buffer.from(await response.Body!.transformToByteArray());
      return decodeEntryHeader(body).header;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** A ranged GET that skips the header, so the packfile never becomes a Buffer. */
  async openEntryPack(repoId: string, ulid: string): Promise<Readable> {
    const head = await this.s3.getObject({
      Bucket: this.s3.bucket,
      Key: this.entryKey(repoId, ulid),
      Range: `bytes=0-${ENTRY_HEADER_PROBE_BYTES - 1}`,
    });
    const { packOffset } = decodeEntryHeader(
      Buffer.from(await head.Body!.transformToByteArray()),
    );

    const response = await this.s3.getObject({
      Bucket: this.s3.bucket,
      Key: this.entryKey(repoId, ulid),
      Range: `bytes=${packOffset}-`,
    });
    return response.Body as Readable;
  }
}

/** 412 lost the race outright, 409 collided with a concurrent conditional write. */
