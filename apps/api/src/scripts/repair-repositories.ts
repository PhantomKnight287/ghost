/**
 * Checks every repository's log for damage no node could replay, which makes every clone of the repository fail, and repairs it with --apply (0034).
 *
 * Run it on the API host: the local caches there are the only place objects missing from a log can still be recovered from. Elsewhere the script still finds every problem, but can only drop what it cannot rescue.
 *
 * Without --apply it only reports. Safe beside a running API: a repair commits through the same compare-and-swap a push does, and starts over if a push lands first.
 *
 * node dist/scripts/repair-repositories.js [--apply], after `nest build`
 */
import { type Database, schema } from '@ghost/db';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';

import { DATABASE, DatabaseModule } from '../database/database.module.js';
import { ownerNameOf } from '../lib/git/repository-access/repository-access.js';
import {
  type RepairReport,
  RepositoryRepairService,
} from '../services/git/repair/repository-repair.service.js';
import { RepositoryStorageService } from '../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../services/git/wal/wal-store.service.js';
import { S3Service } from '../services/s3/s3.service.js';

// Only what a repair needs, so the script opens no HTTP or SSH listener and starts no poller.
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule],
  providers: [
    RepositoryRepairService,
    RepositoryStorageService,
    PushTransactionService,
    WalStoreService,
    S3Service,
  ],
})
class RepairModule {}

const apply = process.argv.includes('--apply');

const app = await NestFactory.createApplicationContext(RepairModule, {
  logger: ['warn', 'error'],
});
const db = app.get<Database>(DATABASE);
const repairs = app.get(RepositoryRepairService);

const repositories = await db
  .select({
    id: schema.repository.id,
    slug: schema.repository.slug,
    owner: ownerNameOf(schema.user, schema.organization),
  })
  .from(schema.repository)
  .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
  .leftJoin(
    schema.organization,
    eq(schema.organization.id, schema.repository.organizationId),
  );

let broken = 0;
let failed = 0;
for (const { id, slug, owner } of repositories) {
  try {
    const report = apply ? await repairs.repair(id) : await repairs.check(id);
    if (!report) continue;
    broken++;
    console.log(`${owner}/${slug} (${id}) ${apply ? 'repaired' : 'broken'}`);
    print(report);
  } catch (error) {
    failed++;
    console.error(
      `${owner}/${slug} (${id}) could not be ${apply ? 'repaired' : 'checked'}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

console.log(
  `${repositories.length} repositories checked, ${broken} ${apply ? 'repaired' : 'broken'}, ${failed} failed`,
);
if (!apply && broken > 0) console.log('Run again with --apply to repair them.');
await app.close();
process.exitCode = failed ? 1 : 0;

function print({ layers, rescued, dropped }: RepairReport) {
  for (const { ulid, outcome, reason } of layers) {
    console.log(`  entry ${ulid} ${outcome}: ${firstLine(reason)}`);
  }
  for (const ref of rescued) {
    console.log(`  ${ref} kept, its missing objects restored from the cache`);
  }
  for (const { ref, oid, reason } of dropped) {
    console.log(`  ${ref} (${oid}) dropped: ${reason}`);
  }
}

function firstLine(text: string) {
  return text.split('\n')[0];
}
