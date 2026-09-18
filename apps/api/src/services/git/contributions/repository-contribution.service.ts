import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { runGitStream, runGit } from '../exec/run-git.js';
import { resolveDefaultRef } from '../tree/resolve-ref.js';

/** Rows buffered before a flush. Keeps a full rebuild's memory bounded. */
const FLUSH_THRESHOLD = 5_000;
/** Postgres caps a statement at 65535 bind parameters; this table binds five. */
const INSERT_CHUNK = 1_000;

const RECORD = '\x1e';
const FIELD = '\x1f';
const FORMAT = `--format=${RECORD}%ae${FIELD}%an${FIELD}%ct`;

interface PendingDay {
  authorEmail: string;
  authorName: string;
  day: string;
  commits: number;
}

/**
 * Keeps `repository_contribution` in step with a repository's default branch,
 * so the profile contribution graph costs one indexed query instead of
 * materializing and walking every repository the user owns.
 *
 * The index is a cache of git, not a second source of truth: it is rebuilt from
 * the object database whenever the stored position stops making sense. Only
 * the default branch is indexed, which is also what the graph renders.
 */
@Injectable()
export class RepositoryContributionService {
  private readonly logger = new Logger(RepositoryContributionService.name);
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Brings the index up to the default tip, returning that tip (null when
   * nothing has been pushed yet). Concurrent callers share one walk.
   */
  async sync({
    repositoryId,
    repoDirectory,
  }: {
    repositoryId: string;
    repoDirectory: string;
  }): Promise<string | null> {
    const pending = this.inFlight.get(repositoryId);
    if (pending) return pending;

    const run = this.reindex({ repositoryId, repoDirectory }).finally(() =>
      this.inFlight.delete(repositoryId),
    );
    this.inFlight.set(repositoryId, run);
    return run;
  }

  private async reindex({
    repositoryId,
    repoDirectory,
  }: {
    repositoryId: string;
    repoDirectory: string;
  }): Promise<string | null> {
    const ref = await resolveDefaultRef({ gitDir: repoDirectory });
    const tip = await this.resolve(repoDirectory, ref);
    if (!tip) {
      await this.forget(repositoryId);
      return null;
    }

    const [state] = await this.db
      .select()
      .from(schema.repositoryContributionIndex)
      .where(eq(schema.repositoryContributionIndex.repositoryId, repositoryId));

    if (state?.indexedCommitSha === tip) {
      // No new commits, but an author may have registered since the last
      // walk: link rows that are still unattributed.
      if (await this.hasUnlinked(repositoryId)) {
        await this.relink(repositoryId);
      }
      return tip;
    }

    // Only a fast-forward can be topped up. A force push or a pruned object
    // makes the stored rows unrelated to the ref, so start over.
    const incremental =
      state !== undefined &&
      (await this.isAncestor(repoDirectory, state.indexedCommitSha, tip));

    if (!incremental) await this.forget(repositoryId);

    const range = incremental ? `${state!.indexedCommitSha}..${tip}` : tip;
    const written = await this.walk({ repositoryId, repoDirectory, range });

    await this.db
      .insert(schema.repositoryContributionIndex)
      .values({ repositoryId, indexedCommitSha: tip })
      .onConflictDoUpdate({
        target: [schema.repositoryContributionIndex.repositoryId],
        set: {
          indexedCommitSha: tip,
          updatedAt: new Date(),
        },
      });

    this.logger.log(
      `Indexed ${written} contribution days for ${repositoryId} (${incremental ? range : 'full rebuild'})`,
    );

    return tip;
  }

  /**
   * Streams the range newest-first, bucketing non-merge commits per author and
   * UTC day. The first name seen for an email is the newest one, so it wins.
   */
  private async walk({
    repositoryId,
    repoDirectory,
    range,
  }: {
    repositoryId: string;
    repoDirectory: string;
    range: string;
  }) {
    const pending = new Map<string, PendingDay>();
    let written = 0;

    const stream = runGitStream({
      args: [
        'log',
        FORMAT,
        '--no-merges',
        // ranges are built from refs, and one starting with "-" would parse as
        // an option rather than as a revision
        '--end-of-options',
        range,
      ],
      gitDir: repoDirectory,
    });

    let carry = '';
    for await (const chunk of stream) {
      carry += chunk;
      const records = carry.split(RECORD);
      carry = records.pop() ?? '';
      for (const record of records) {
        this.accumulate(pending, record);
        if (pending.size >= FLUSH_THRESHOLD) {
          written += await this.flush(repositoryId, pending);
        }
      }
    }
    const trailing = this.accumulate(pending, carry);
    if (trailing && pending.size >= FLUSH_THRESHOLD) {
      written += await this.flush(repositoryId, pending);
    }

    written += await this.flush(repositoryId, pending);
    return written;
  }

  /** Returns false for blank or malformed records, which are skipped. */
  private accumulate(pending: Map<string, PendingDay>, record: string) {
    const [email, name, epoch] = record.split(FIELD);
    if (!email || !epoch) return false;
    const seconds = Number.parseInt(epoch, 10);
    if (!Number.isFinite(seconds)) return false;

    const authorEmail = email.toLowerCase();
    const day = new Date(seconds * 1000).toISOString().slice(0, 10);
    const key = `${authorEmail}\x1f${day}`;
    const existing = pending.get(key);
    if (existing) {
      existing.commits += 1;
    } else {
      pending.set(key, {
        authorEmail,
        authorName: name || email,
        day,
        commits: 1,
      });
    }
    return true;
  }

  private async flush(repositoryId: string, pending: Map<string, PendingDay>) {
    const rows = [...pending.values()].map((row) => ({
      repositoryId,
      ...row,
    }));
    pending.clear();

    const authorIds = await this.resolveAuthorIds(
      rows.map((row) => row.authorEmail),
    );

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await this.db
        .insert(schema.repositoryContribution)
        .values(
          rows.slice(i, i + INSERT_CHUNK).map((row) => ({
            ...row,
            authorId: authorIds.get(row.authorEmail) ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [
            schema.repositoryContribution.repositoryId,
            schema.repositoryContribution.authorEmail,
            schema.repositoryContribution.day,
          ],
          set: {
            commits: sql`${schema.repositoryContribution.commits} + excluded.commits`,
            authorName: sql`excluded."author_name"`,
            // Never unlink on a top-up: a missing match means "unknown",
            // not "no longer theirs".
            authorId: sql`coalesce(excluded."author_id", ${schema.repositoryContribution.authorId})`,
          },
        });
    }

    return rows.length;
  }

  /** Maps lowercased author emails to account ids, one query per flush. */
  private async resolveAuthorIds(emails: string[]) {
    const distinct = [...new Set(emails)];
    if (distinct.length === 0) return new Map<string, string>();

    const users = await this.db
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user)
      .where(inArray(sql`lower(${schema.user.email})`, distinct));

    return new Map(users.map((user) => [user.email.toLowerCase(), user.id]));
  }

  private async hasUnlinked(repositoryId: string) {
    const [row] = await this.db
      .select({ one: sql`1` })
      .from(schema.repositoryContribution)
      .where(
        and(
          eq(schema.repositoryContribution.repositoryId, repositoryId),
          isNull(schema.repositoryContribution.authorId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Links unattributed rows to accounts that appeared after the commits were
   * indexed - a registration, or an email added to an account later. The next
   * sync then finds nothing left to link.
   */
  private async relink(repositoryId: string) {
    await this.db.execute(sql`
      UPDATE "repository_contribution" AS c
      SET "author_id" = u."id"
      FROM "user" AS u
      WHERE c."repository_id" = ${repositoryId}
        AND c."author_id" IS NULL
        AND lower(u."email") = c."author_email"
    `);
  }

  private async forget(repositoryId: string) {
    await this.db
      .delete(schema.repositoryContribution)
      .where(eq(schema.repositoryContribution.repositoryId, repositoryId));
    await this.db
      .delete(schema.repositoryContributionIndex)
      .where(eq(schema.repositoryContributionIndex.repositoryId, repositoryId));
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
