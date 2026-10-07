import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, eq, inArray } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { resolveCommit } from '../../../lib/git/tree/resolve-ref.js';
import { walkCommits } from '../../../lib/git/path-index/commit-log.js';
import { isoTimestamp, excluded } from '../../../utils/index.js';
import { isAncestor } from '../../../lib/git/diff/diff.js';
import { errorMessage } from '../../../lib/error-message.js';
import { SingleFlight } from '../../../lib/single-flight.js';

/** Rows buffered before a flush. Keeps a full rebuild's memory bounded. */
const FLUSH_THRESHOLD = 5_000;
/** Postgres caps a statement at 65535 bind parameters; this table binds six. */
const INSERT_CHUNK = 1_000;

interface IndexedCommit {
  commitSha: string;
  committedAt: Date;
  subject: string;
}

interface PendingRow extends IndexedCommit {
  path: string;
}

export interface PathCommit {
  sha: string;
  subject: string;
  /** Committer timestamp, ISO 8601. */
  committedAt: string;
}

/**
 * Keeps `repository_path_commit` in step with a ref, so listing a directory never has to walk history per entry.
 *
 * The index is a cache of git, not a second source of truth: it is rebuilt from the object database whenever the stored position stops making sense.
 */
@Injectable()
export class RepositoryPathIndexService {
  private readonly logger = new Logger(RepositoryPathIndexService.name);
  private readonly inFlight = new SingleFlight<string | null>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Brings the index up to the ref's tip, returning that tip (null when the ref does not exist). Concurrent callers share one walk. */
  async sync({
    repositoryId,
    repoDirectory,
    ref,
  }: {
    repositoryId: string;
    repoDirectory: string;
    ref: string;
  }): Promise<string | null> {
    const key = `${repositoryId}:${ref}`;
    return this.inFlight.run(key, () =>
      this.reindex({ repositoryId, repoDirectory, ref }),
    );
  }

  /** Whether `lookup` answers for the ref's tip now. A fast-forward top-up is waited for; a first build or a rebuild walks the whole history, so it runs in the background and this returns false until it lands. False too when the ref does not exist. */
  async ensureIndexed({
    repositoryId,
    repoDirectory,
    ref,
  }: {
    repositoryId: string;
    repoDirectory: string;
    ref: string;
  }): Promise<boolean> {
    const tip = await resolveCommit(repoDirectory, ref);
    if (!tip) return false;

    const [state] = await this.db
      .select()
      .from(schema.repositoryRefIndex)
      .where(
        and(
          eq(schema.repositoryRefIndex.repositoryId, repositoryId),
          eq(schema.repositoryRefIndex.ref, ref),
        ),
      );
    if (state?.indexedCommitSha === tip) return true;

    if (
      state &&
      (await isAncestor(repoDirectory, state.indexedCommitSha, tip))
    ) {
      // A walk already in flight may have started before the ref moved to this tip.
      return (await this.sync({ repositoryId, repoDirectory, ref })) === tip;
    }

    this.sync({ repositoryId, repoDirectory, ref }).catch((error: unknown) =>
      this.logger.warn(
        `Path index build failed for ${repositoryId} ${ref}: ${errorMessage(error)}`,
      ),
    );
    return false;
  }

  /** Latest commit per path, for the paths a listing actually shows. */
  async lookup({
    repositoryId,
    ref,
    paths,
  }: {
    repositoryId: string;
    ref: string;
    paths: string[];
  }): Promise<Map<string, PathCommit>> {
    if (paths.length === 0) return new Map();

    const rows = await this.db
      .select({
        path: schema.repositoryPathCommit.path,
        sha: schema.repositoryPathCommit.commitSha,
        subject: schema.repositoryPathCommit.subject,
        committedAt: isoTimestamp(schema.repositoryPathCommit.committedAt),
      })
      .from(schema.repositoryPathCommit)
      .where(
        and(
          eq(schema.repositoryPathCommit.repositoryId, repositoryId),
          eq(schema.repositoryPathCommit.ref, ref),
          inArray(schema.repositoryPathCommit.path, paths),
        ),
      );

    return new Map(rows.map(({ path, ...commit }) => [path, commit]));
  }

  private async reindex({
    repositoryId,
    repoDirectory,
    ref,
  }: {
    repositoryId: string;
    repoDirectory: string;
    ref: string;
  }): Promise<string | null> {
    const tip = await resolveCommit(repoDirectory, ref);
    if (!tip) {
      await this.forget(repositoryId, ref);
      return null;
    }

    const [state] = await this.db
      .select()
      .from(schema.repositoryRefIndex)
      .where(
        and(
          eq(schema.repositoryRefIndex.repositoryId, repositoryId),
          eq(schema.repositoryRefIndex.ref, ref),
        ),
      );

    if (state?.indexedCommitSha === tip) return tip;

    // Only a fast-forward can be topped up. A force push or a pruned object makes the stored rows unrelated to the ref, so start over.
    const incremental =
      state !== undefined &&
      (await isAncestor(repoDirectory, state.indexedCommitSha, tip));

    if (!incremental) await this.forget(repositoryId, ref);

    const range = incremental ? `${state!.indexedCommitSha}..${tip}` : tip;
    const written = await this.walk({
      repositoryId,
      repoDirectory,
      ref,
      range,
    });

    await this.db
      .insert(schema.repositoryRefIndex)
      .values({ repositoryId, ref, indexedCommitSha: tip })
      .onConflictDoUpdate({
        target: [
          schema.repositoryRefIndex.repositoryId,
          schema.repositoryRefIndex.ref,
        ],
        set: {
          indexedCommitSha: tip,
          updatedAt: new Date(),
        },
      });

    this.logger.log(
      `Indexed ${written} paths for ${repositoryId} ${ref} (${incremental ? range : 'full rebuild'})`,
    );

    return tip;
  }

  /** Walks the range oldest-first, keeping the last commit seen per path. Every ancestor directory of a changed file is recorded too, so a directory row carries the newest commit anywhere beneath it. */
  private async walk({
    repositoryId,
    repoDirectory,
    ref,
    range,
  }: {
    repositoryId: string;
    repoDirectory: string;
    ref: string;
    range: string;
  }) {
    const pending = new Map<string, PendingRow>();
    let written = 0;

    for await (const commit of walkCommits({ gitDir: repoDirectory, range })) {
      const touched: IndexedCommit = {
        commitSha: commit.sha,
        committedAt: commit.committedAt,
        subject: commit.subject,
      };

      for (const path of commit.paths) {
        for (const ancestor of ancestorsOf(path)) {
          pending.set(ancestor, { path: ancestor, ...touched });
        }
      }

      if (pending.size >= FLUSH_THRESHOLD) {
        written += await this.flush(repositoryId, ref, pending);
      }
    }

    written += await this.flush(repositoryId, ref, pending);
    return written;
  }

  private async flush(
    repositoryId: string,
    ref: string,
    pending: Map<string, PendingRow>,
  ) {
    const rows = [...pending.values()].map((row) => ({
      repositoryId,
      ref,
      ...row,
    }));
    pending.clear();

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await this.db
        .insert(schema.repositoryPathCommit)
        .values(rows.slice(i, i + INSERT_CHUNK))
        .onConflictDoUpdate({
          target: [
            schema.repositoryPathCommit.repositoryId,
            schema.repositoryPathCommit.ref,
            schema.repositoryPathCommit.path,
          ],
          set: {
            commitSha: excluded(schema.repositoryPathCommit.commitSha),
            committedAt: excluded(schema.repositoryPathCommit.committedAt),
            subject: excluded(schema.repositoryPathCommit.subject),
          },
        });
    }

    return rows.length;
  }

  private async forget(repositoryId: string, ref: string) {
    await this.db
      .delete(schema.repositoryPathCommit)
      .where(
        and(
          eq(schema.repositoryPathCommit.repositoryId, repositoryId),
          eq(schema.repositoryPathCommit.ref, ref),
        ),
      );
    await this.db
      .delete(schema.repositoryRefIndex)
      .where(
        and(
          eq(schema.repositoryRefIndex.repositoryId, repositoryId),
          eq(schema.repositoryRefIndex.ref, ref),
        ),
      );
  }
}

/** "src/a/b.ts" -> ["src/a/b.ts", "src/a", "src", ""] */
export function ancestorsOf(path: string) {
  const segments = path.split('/');
  const paths: string[] = [];
  for (let i = segments.length; i > 0; i--) {
    paths.push(segments.slice(0, i).join('/'));
  }
  paths.push('');
  return paths;
}
