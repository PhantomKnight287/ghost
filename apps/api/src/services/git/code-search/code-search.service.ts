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
  searchIndex,
} from '../../../lib/git/code-search/zoekt.js';
import { resolveCommit } from '../../../lib/git/tree/resolve-ref.js';
import { isNotFound } from '../../../lib/s3/s3.errors.js';
import { S3Service } from '../../s3/s3.service.js';

// The search node mirrors this prefix into its index directory, so nothing but shards may live under it.
const SHARD_PREFIX = 'zoekt/';
const MARKER_PREFIX = 'zoekt-state/';

/** Indexes repositories as they are opened and publishes the shards to S3, where the zoekt node picks them up. Unset `ZOEKT_URL` turns code search off. */
@Injectable()
export class CodeSearchService {
  private readonly logger = new Logger(CodeSearchService.name);
  private readonly url?: string;
  private readonly running = new Map<string, Promise<void>>();
  private readonly dirty = new Set<string>();
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

    const running = this.running.get(target.repositoryId);
    if (running) {
      this.dirty.add(target.repositoryId);
      return running;
    }

    const run = (async () => {
      do {
        this.dirty.delete(target.repositoryId);
        await this.publish(target);
      } while (this.dirty.has(target.repositoryId));
    })().finally(() => this.running.delete(target.repositoryId));

    this.running.set(target.repositoryId, run);
    return run;
  }

  /** Waits out an index run in flight first, so it cannot publish shards after they are removed. */
  async remove(repositoryId: string) {
    this.dirty.delete(repositoryId);
    await this.running.get(repositoryId)?.catch(() => undefined);
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
        `Code search index failed for ${target.repositoryId}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  async searchRepository({
    query,
    limit,
    ...target
  }: IndexTarget & { query: string; limit: number }) {
    const url = this.requireUrl();

    const indexing =
      this.running.has(target.repositoryId) ||
      (await this.unpublishedStamp(target)) !== null;
    if (indexing) this.indexInBackground(target);

    const hits = await searchIndex({
      url,
      query: `r:^${target.repositoryId}$ (${query})`,
      limit,
    });

    return {
      indexing,
      // The query can close the parenthesis and OR in other repositories: the `r:` above only narrows the scan, this filter is what enforces access.
      files: hits.filter((hit) => hit.repositoryId === target.repositoryId),
    };
  }

  /** Narrowed to shards flagged public, but a query can OR its way out of that: the caller must still keep only repositories it knows to be public. */
  async searchPublic({ query, limit }: { query: string; limit: number }) {
    return searchIndex({
      url: this.requireUrl(),
      query: `public:yes (${query})`,
      limit,
    });
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
