/**
 * Bills every repository for the log entries pushed before pushes were recorded (0035). Until it runs, those bytes count for nothing against any quota.
 *
 * Without --apply it only reports. Safe beside a running API and safe to run again: rows are keyed by entry, so a push recorded meanwhile is skipped.
 *
 * node dist/scripts/backfill-storage-usage.js [--apply], after `nest build`
 */
import { type Database, schema } from '@ghost/db';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { DATABASE, DatabaseModule } from '../database/database.module.js';
import { formatByteSize } from '../lib/storage/byte-size.js';
import { WalStoreService } from '../services/git/wal/wal-store.service.js';
import { S3Service } from '../services/s3/s3.service.js';
import { RepositoryLogBackfillService } from '../services/storage/repository-log-backfill.service.js';

// Only what a backfill needs, so the script opens no HTTP or SSH listener and starts no poller.
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule],
  providers: [RepositoryLogBackfillService, WalStoreService, S3Service],
})
class BackfillModule {}

const apply = process.argv.includes('--apply');

const app = await NestFactory.createApplicationContext(BackfillModule, {
  logger: ['warn', 'error'],
});
const db = app.get<Database>(DATABASE);
const backfill = app.get(RepositoryLogBackfillService);

const repositories = await db
  .select({ id: schema.repository.id })
  .from(schema.repository);

let failed = 0;
let total = 0;
for (const { id } of repositories) {
  try {
    const rows = await backfill.missingEntries(id);
    if (rows.length === 0) continue;
    const bytes = apply
      ? await backfill.record(rows)
      : rows.reduce((sum, { size }) => sum + size, 0);
    total += bytes;
    console.log(`${id}: ${rows.length} entries, ${formatByteSize(bytes)}`);
  } catch (error) {
    failed++;
    console.error(
      `${id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

console.log(
  `${apply ? 'Billed' : 'Would bill'} ${formatByteSize(total)} across ${repositories.length - failed} of ${repositories.length} repositories`,
);
await app.close();
process.exitCode = failed ? 1 : 0;
