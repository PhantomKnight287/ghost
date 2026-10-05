import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { WalStoreService } from '../git/wal/wal-store.service.js';

// Three columns per row, well under Postgres' 65535 bind parameters.
const INSERT_BATCH = 5000;

export interface LogEntryRow {
  repositoryId: string;
  ulid: string;
  size: number;
}

/** Bills log entries written before pushes were recorded (0035). */
@Injectable()
export class RepositoryLogBackfillService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly wal: WalStoreService,
  ) {}

  /** Entries of the repository's log with no billing row. Entries Ghost wrote for pull requests are billed through their own rows (0033), so they are left out. */
  async missingEntries(repositoryId: string): Promise<LogEntryRow[]> {
    // Read before the rows: a pull ref write records its intent before its entry reaches the index, so every such entry this index holds is already in the rows below.
    const stored = await this.wal.readIndex(repositoryId);
    if (!stored) return [];

    const [billed, pullRefWrites, pendingPullRefWrites] = await Promise.all([
      this.db
        .select({ ulid: schema.repositoryLogEntry.ulid })
        .from(schema.repositoryLogEntry)
        .where(eq(schema.repositoryLogEntry.repositoryId, repositoryId)),
      this.db
        .select({ id: schema.pullRequestRefWrite.id })
        .from(schema.pullRequestRefWrite)
        .innerJoin(
          schema.pullRequest,
          eq(schema.pullRequest.id, schema.pullRequestRefWrite.pullRequestId),
        )
        .where(eq(schema.pullRequest.baseRepositoryId, repositoryId)),
      this.db
        .select({ id: schema.pullRequestRefWritePending.id })
        .from(schema.pullRequestRefWritePending)
        .innerJoin(
          schema.pullRequest,
          eq(
            schema.pullRequest.id,
            schema.pullRequestRefWritePending.pullRequestId,
          ),
        )
        .where(eq(schema.pullRequest.baseRepositoryId, repositoryId)),
    ]);
    const skip = new Set([
      ...billed.map(({ ulid }) => ulid),
      ...pullRefWrites.map(({ id }) => id.slice('prw_'.length)),
      ...pendingPullRefWrites.map(({ id }) => id),
    ]);

    return stored.index.layers
      .filter(({ ulid }) => !skip.has(ulid))
      .map(({ ulid, size }) => ({ repositoryId, ulid, size }));
  }

  /** Bytes actually recorded: a row a push recorded meanwhile is skipped and not counted. */
  async record(rows: LogEntryRow[]) {
    let recorded = 0;
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      const inserted = await this.db
        .insert(schema.repositoryLogEntry)
        .values(rows.slice(start, start + INSERT_BATCH))
        .onConflictDoNothing()
        .returning({ size: schema.repositoryLogEntry.size });
      recorded += inserted.reduce((sum, { size }) => sum + size, 0);
    }
    return recorded;
  }
}
