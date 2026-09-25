import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  countDistinct,
  desc,
  eq,
  inArray,
  isNull,
  max,
  sql,
  sum,
} from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { runGit, runGitStream } from '../../../lib/git/exec/run-git.js';
import { resolveCommit } from '../../../lib/git/tree/resolve-ref.js';
import { resolveDefaultRef } from '../../../lib/git/tree/resolve-ref.js';

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
 * Keeps `repository_contribution` in step with a repository's default branch, so the profile contribution graph costs one indexed query instead of materializing and walking every repository the user owns.
 *
 * A cache of git, rebuilt from the object database whenever the stored position stops making sense. Only the default branch is indexed.
 */
export interface IndexedContributor {
  authorEmail: string;
  /** Name from the author's newest indexed commit, preferring the account's. */
  authorName: string;
  username: string | null;
  image: string | null;
  commits: number;
  /** Newest indexed day, UTC midnight. Day-granular: the index has no times. */
  lastCommittedAt: Date;
}

@Injectable()
export class RepositoryContributionService {
  private readonly logger = new Logger(RepositoryContributionService.name);
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Brings the index up to the default tip, returning that tip (null when nothing has been pushed yet). Concurrent callers share one walk. */
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

  /** The contributors list, straight from the index: per-author totals with the linked account resolved over the `author_id` foreign key. No git, no materialization - callers only need read access to the repository row. */
  async listContributors({
    repositoryId,
    limit = 100,
  }: {
    repositoryId: string;
    limit?: number;
  }): Promise<{
    contributors: IndexedContributor[];
    totalCommits: number;
    totalContributors: number;
  }> {
    const pageSize = Math.min(Math.max(Math.trunc(limit) || 100, 1), 100);
    const contribution = schema.repositoryContribution;
    // One person can commit from several addresses, so the grain of the list is the account where there is one, and the address where there is not.
    const identity = sql`coalesce(${contribution.authorId}, ${contribution.authorEmail})`;

    const [rows, [totals]] = await Promise.all([
      this.db
        .select({
          // Newest address wins, for an author with no account to name.
          authorEmail: sql<string>`(array_agg(${contribution.authorEmail} ORDER BY ${contribution.day} DESC))[1]`,
          // Newest name wins: the name on the author's latest indexed day, preferring the linked account's below.
          gitName: sql<string>`(array_agg(${contribution.authorName} ORDER BY ${contribution.day} DESC))[1]`,
          username: schema.user.username,
          name: schema.user.name,
          image: schema.user.image,
          commits: sum(contribution.commits),
          lastDay: max(contribution.day),
        })
        .from(contribution)
        .leftJoin(schema.user, eq(schema.user.id, contribution.authorId))
        .where(eq(contribution.repositoryId, repositoryId))
        .groupBy(
          identity,
          schema.user.username,
          schema.user.name,
          schema.user.image,
        )
        .orderBy(desc(sum(contribution.commits)))
        .limit(pageSize),
      this.db
        .select({
          commits: sum(contribution.commits),
          authors: countDistinct(identity),
        })
        .from(contribution)
        .where(eq(contribution.repositoryId, repositoryId)),
    ]);

    return {
      contributors: rows.flatMap((row) => {
        if (!row.lastDay) return [];
        return [
          {
            authorEmail: row.authorEmail,
            authorName: row.name ?? row.gitName,
            username: row.username,
            image: row.image,
            commits: Number(row.commits ?? 0),
            lastCommittedAt: new Date(`${row.lastDay}T00:00:00Z`),
          },
        ];
      }),
      totalCommits: Number(totals?.commits ?? 0),
      totalContributors: Number(totals?.authors ?? 0),
    };
  }

  private async reindex({
    repositoryId,
    repoDirectory,
  }: {
    repositoryId: string;
    repoDirectory: string;
  }): Promise<string | null> {
    const ref = await resolveDefaultRef({ gitDir: repoDirectory });
    const tip = await resolveCommit(repoDirectory, ref);
    if (!tip) {
      await this.forget(repositoryId);
      return null;
    }

    const [state] = await this.db
      .select()
      .from(schema.repositoryContributionIndex)
      .where(eq(schema.repositoryContributionIndex.repositoryId, repositoryId));

    if (state?.indexedCommitSha === tip) {
      // No new commits, but an author may have registered since the last walk: link rows that are still unattributed.
      if (await this.hasUnlinked(repositoryId)) {
        await this.relink(repositoryId);
      }
      return tip;
    }

    // Only a fast-forward can be topped up. A force push or a pruned object makes the stored rows unrelated to the ref, so start over.
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

  /** Streams the range newest-first, bucketing non-merge commits per author and UTC day. The first name seen for an email is the newest one, so it wins. */
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
        // ranges are built from refs, and one starting with "-" would parse as an option rather than as a revision
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
            // Never unlink on a top-up: a missing match means "unknown", not "no longer theirs".
            authorId: sql`coalesce(excluded."author_id", ${schema.repositoryContribution.authorId})`,
          },
        });
    }

    return rows.length;
  }

  /** Maps lowercased author emails to account ids. An account is reachable under its primary address and under every verified extra, so a person who commits from two addresses attributes to one account. */
  private async resolveAuthorIds(emails: string[]) {
    const distinct = [...new Set(emails)];
    if (distinct.length === 0) return new Map<string, string>();

    const [primaries, extras] = await Promise.all([
      this.db
        .select({ id: schema.user.id, email: schema.user.email })
        .from(schema.user)
        .where(inArray(sql`lower(${schema.user.email})`, distinct)),
      this.db
        .select({ id: schema.userEmail.userId, email: schema.userEmail.email })
        .from(schema.userEmail)
        .where(
          and(
            inArray(schema.userEmail.email, distinct),
            eq(schema.userEmail.verified, true),
          ),
        ),
    ]);

    return new Map(
      [...extras, ...primaries].map((row) => [row.email.toLowerCase(), row.id]),
    );
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

  /** Links unattributed rows to accounts that appeared after the commits were indexed - a registration, or an email added to an account later. The next sync then finds nothing left to link. */
  private async relink(repositoryId: string) {
    await this.db.execute(sql`
      UPDATE "repository_contribution" AS c
      SET "author_id" = u."id"
      FROM "user" AS u
      WHERE c."repository_id" = ${repositoryId}
        AND c."author_id" IS NULL
        AND lower(u."email") = c."author_email"
    `);
    await this.db.execute(sql`
      UPDATE "repository_contribution" AS c
      SET "author_id" = e."user_id"
      FROM "user_email" AS e
      WHERE c."repository_id" = ${repositoryId}
        AND c."author_id" IS NULL
        AND e."verified" = true
        AND e."email" = c."author_email"
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

  private async isAncestor(
    repoDirectory: string,
    ancestor: string,
    descendant: string,
  ) {
    // Exits non-zero both for "not an ancestor" and for an object that is gone; either way the stored position is unusable.
    return runGit({
      args: ['merge-base', '--is-ancestor', ancestor, descendant],
      gitDir: repoDirectory,
    }).then(
      () => true,
      () => false,
    );
  }
}
