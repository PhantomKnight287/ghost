/**
 * Writes `refs/pull/<n>/head` and `refs/pull/<n>/merge` for every open pull request opened before Ghost kept them. A request that is read or pushed to catches up on its own; this covers the ones nobody touches.
 *
 * Safe beside a running API: every write is a compare-and-swap on the log, and a sync that finds its refs current writes nothing.
 *
 * node dist/scripts/backfill-pull-refs.js, after `nest build`
 */
import { schema, type Database } from '@ghost/db';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';

import { DATABASE, DatabaseModule } from '../database/database.module.js';
import { PullRefsModule } from '../pull-refs/pull-refs.module.js';
import { PullRefsService } from '../services/git/pull-refs/pull-refs.service.js';
import { errorMessage } from '../lib/error-message.js';

// Only what a sync needs, so the script opens no HTTP or SSH listener and starts no poller.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    PullRefsModule,
  ],
})
class BackfillModule {}

const app = await NestFactory.createApplicationContext(BackfillModule, {
  logger: ['warn', 'error'],
});
const db = app.get<Database>(DATABASE);
const pullRefs = app.get(PullRefsService);

const open = await db
  .select({ id: schema.pullRequest.id })
  .from(schema.pullRequest)
  .where(eq(schema.pullRequest.state, 'open'));

let failed = 0;
for (const { id } of open) {
  try {
    await pullRefs.sync(id);
  } catch (error) {
    failed++;
    console.error(`${id}: ${errorMessage(error)}`);
  }
}

console.log(
  `${open.length - failed} of ${open.length} open pull requests synced`,
);
await app.close();
process.exitCode = failed ? 1 : 0;
