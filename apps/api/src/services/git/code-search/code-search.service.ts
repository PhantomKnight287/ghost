import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CodeSearchUnavailableError } from '../../../lib/git/code-search/code-search.errors.js';
import type { IndexTarget } from '../../../lib/git/code-search/code-search.types.js';
import {
  indexRepository,
  listMatchingFiles,
  repositoryScope,
  searchFiles,
} from '../../../lib/git/code-search/zoekt.js';
import { resolveCommit } from '../../../lib/git/tree/resolve-ref.js';
import { isNotFound } from '../../../lib/s3/s3.errors.js';
import { S3Service } from '../../s3/s3.service.js';
import { errorMessage } from '../../../lib/error-message.js';
import { Coalescer } from '../../../lib/coalescer.js';

// The search node mirrors this prefix into its index directory, so nothing but shards may live under it.
const SHARD_PREFIX = 'zoekt/';
const MARKER_PREFIX = 'zoekt-state/';

/** Indexes repositories as they are opened and publishes the shards to S3, where the zoekt node picks them up. Unset `ZOEKT_URL` turns code search off. */
@Injectable()
export class CodeSearchService {
  private readonly logger = new Logger(CodeSearchService.name);
  private readonly url?: string;
  private readonly indexing = new Coalescer();
  // Every repository page opens the repository, so the heads this process knows are published spare S3 a marker read per view.
  private readonly published = new Map<string, string>();

  constructor(
    config: ConfigService,
    private readonly s3: S3Service,
  ) {
    this.url = config.get<string>('ZOEKT_URL') || undefined;
  }

  /** A call while a run is in flight queues exactly one rerun, so the latest HEAD always gets indexed. */
  index(target: IndexTarget): Promise<void> {
    if (!this.url) return Promise.resolve();

    return this.indexing.run(target.repositoryId, () => this.publish(target));
  }

  /** Waits out an index run in flight first, so it cannot publish shards after they are removed. */
  async remove(repositoryId: string) {
    await this.indexing.settle(repositoryId);
    this.published.delete(repositoryId);

    await this.s3.deleteUnder(`${SHARD_PREFIX}${repositoryId}_v`);
    await this.s3.deleteObject({
      Bucket: this.s3.bucket,
      Key: `${MARKER_PREFIX}${repositoryId}`,
    });
  }

  /** Reads must neither wait on nor fail because of the search index. */
  indexInBackground(target: IndexTarget) {
    this.index(target).catch((error: unknown) =>
      this.logger.warn(
        `Code search index failed for ${target.repositoryId}: ${errorMessage(error)}`,
      ),
    );
  }

  async searchRepository({
    query,
    cursor,
    limit,
    ...target
  }: IndexTarget & { query: string; cursor?: string; limit: number }) {
    const indexing =
      this.indexing.isRunning(target.repositoryId) ||
      (await this.unpublishedStamp(target)) !== null;
    if (indexing) this.indexInBackground(target);

    const page = await this.searchPage({
      query: `r:^${target.repositoryId}$ (${query})`,
      cursor,
      limit,
      visible: () => new Set([target.repositoryId]),
    });
    return { indexing, ...page };
  }

  /** Narrowed to shards flagged public and, given `repositoryIds`, to those repositories; a query can OR its way out of both, so `visible` must keep only repositories the caller knows to be public and in scope. */
  async searchPublic({
    query,
    repositoryIds,
    ...page
  }: {
    query: string;
    cursor?: string;
    limit: number;
    repositoryIds?: string[];
    visible: (repositoryIds: string[]) => Promise<Set<string>>;
  }) {
    return this.searchPage({
      query: `public:yes${repositoryScope(repositoryIds)} (${query})`,
      ...page,
    });
  }

  /** One page of matching files, best first. The query can reach any repository, so `visible` is what enforces access, and it runs before the page is cut so a hidden file never takes a slot. `cursor` is the offset into the visible list, validated by the DTO. */
  private async searchPage({
    query,
    cursor,
    limit,
    visible,
  }: {
    query: string;
    cursor?: string;
    limit: number;
    visible: (repositoryIds: string[]) => Set<string> | Promise<Set<string>>;
  }) {
    const url = this.requireUrl();
    const offset = Number(cursor ?? 0);

    const listed = await listMatchingFiles({ url, query });
    const allowed = await visible([
      ...new Set(listed.map((file) => file.repositoryId)),
    ]);
    const files = listed.filter((file) => allowed.has(file.repositoryId));

    const end = offset + limit;
    return {
      // searchFiles answers only for the files it is given, however the query is written
      files: await searchFiles({ url, query, files: files.slice(offset, end) }),
      nextCursor: end < files.length ? String(end) : null,
    };
  }

  private requireUrl() {
    if (!this.url) throw new CodeSearchUnavailableError();
    return this.url;
  }

  private async publish(target: IndexTarget) {
    const stamp = await this.unpublishedStamp(target);
    if (!stamp) return;

    const indexDir = await mkdtemp(path.join(tmpdir(), 'ghost-zoekt-'));
    try {
      const shards = await indexRepository({
        indexDir,
        repoDirectory: target.repoDirectory,
        name: target.repositoryId,
        isPublic: target.isPublic,
      });
      const keys = shards.map((name) => `${SHARD_PREFIX}${name}`);

      for (const [i, name] of shards.entries()) {
        const file = path.join(indexDir, name);
        await this.s3.putObject({
          Bucket: this.s3.bucket,
          Key: keys[i],
          Body: createReadStream(file),
          ContentLength: (await stat(file)).size,
        });
      }
      // The marker moves last: a crash before it leaves the marker behind, and behind only costs a reindex.
      await this.s3.deleteUnder(
        `${SHARD_PREFIX}${target.repositoryId}_v`,
        keys,
      );
      await this.s3.putObject({
        Bucket: this.s3.bucket,
        Key: `${MARKER_PREFIX}${target.repositoryId}`,
        Body: stamp,
      });
    } finally {
      await rm(indexDir, { recursive: true, force: true });
    }

    this.published.set(target.repositoryId, stamp);
    this.logger.log(
      `Published code search shards for ${target.repositoryId} at ${stamp}`,
    );
  }

  /** HEAD and visibility, as `<sha> public|private`, when the published shards are missing or describe something else; null when they are current. An empty repository has nothing to index. */
  private async unpublishedStamp({
    repositoryId,
    repoDirectory,
    isPublic,
  }: IndexTarget) {
    const head = await resolveCommit(repoDirectory, 'HEAD');
    if (!head) return null;
    const stamp = `${head} ${isPublic ? 'public' : 'private'}`;
    if (this.published.get(repositoryId) === stamp) return null;

    try {
      const marker = await this.s3.getObject({
        Bucket: this.s3.bucket,
        Key: `${MARKER_PREFIX}${repositoryId}`,
      });
      if ((await marker.Body!.transformToString()) !== stamp) return stamp;
    } catch (error) {
      if (isNotFound(error)) return stamp;
      throw error;
    }

    this.published.set(repositoryId, stamp);
    return null;
  }
}
