import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { runGit } from '../exec/run-git.js';
import { walkCommits } from './commit-log.js';

/** Rows buffered before a flush. Keeps a full rebuild's memory bounded. */
const FLUSH_THRESHOLD = 5_000;
/** Postgres caps a statement at 65535 bind parameters; this table binds six. */
const INSERT_CHUNK = 1_000;

export interface PathCommit {
  commitSha: string;
  committedAt: Date;
  subject: string;
}

interface PendingRow extends PathCommit {
  path: string;
}

/**
 * Keeps `repository_path_commit` in step with a ref, so listing a directory
 * never has to walk history per entry.
 *
 * The index is a cache of git, not a second source of truth: it is rebuilt from
 * the object database whenever the stored position stops making sense.
 */
@Injectable()
export class RepositoryPathIndexService {
  private readonly logger = new Logger(RepositoryPathIndexService.name);
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Brings the index up to the ref's tip, returning that tip (null when the ref
   * does not exist). Concurrent callers share one walk.
   */
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
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const run = this.reindex({ repositoryId, repoDirectory, ref }).finally(() =>
      this.inFlight.delete(key),
    );
    this.inFlight.set(key, run);
    return run;
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
        commitSha: schema.repositoryPathCommit.commitSha,
        committedAt: schema.repositoryPathCommit.committedAt,
        subject: schema.repositoryPathCommit.subject,
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
    const tip = await this.resolve(repoDirectory, ref);
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

    // Only a fast-forward can be topped up. A force push or a pruned object
    // makes the stored rows unrelated to the ref, so start over.
    const incremental =
      state !== undefined &&
      (await this.isAncestor(repoDirectory, state.indexedCommitSha, tip));

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

  /**
   * Walks the range oldest-first, keeping the last commit seen per path. Every
   * ancestor directory of a changed file is recorded too, so a directory row
   * carries the newest commit anywhere beneath it.
   */
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
      const touched: PathCommit = {
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
            commitSha: sql`excluded."commitSha"`,
            committedAt: sql`excluded."committedAt"`,
            subject: sql`excluded."subject"`,
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

  private async resolve(repoDirectory: string, ref: string) {
    const oid = await runGit({
      args: [
        'rev-parse',
        '--verify',
        '--quiet',
        '--end-of-options',
        `${ref}^{commit}`,
      ],
      gitDir: repoDirectory,
    }).catch(() => '');
    return oid.trim() || null;
  }

  private async isAncestor(
    repoDirectory: string,
    ancestor: string,
    descendant: string,
  ) {
    // Exits non-zero both for "not an ancestor" and for an object that is gone;
    // either way the stored position is unusable.
    return runGit({
      args: ['merge-base', '--is-ancestor', ancestor, descendant],
      gitDir: repoDirectory,
    }).then(
      () => true,
      () => false,
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
