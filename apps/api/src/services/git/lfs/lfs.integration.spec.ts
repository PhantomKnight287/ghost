import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lfsObjectKey } from '../../../lib/git/lfs/lfs-objects.js';
import { LfsObjectMismatchError } from '../../../lib/git/lfs/lfs.errors.js';
import { InMemoryS3 } from '../../../lib/s3/s3.fake.js';
import type { S3Service } from '../../s3/s3.service.js';
import { StorageQuotaService } from '../../storage/storage-quota.service.js';
import { LfsService } from './lfs.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../../packages/db/drizzle',
);
const OWNER = 'user_lfs_owner';

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('LfsService', () => {
  let db: Database;
  let pool: Pool;
  let s3: InMemoryS3;
  let lfs: LfsService;
  let repository: typeof schema.repository.$inferSelect;

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION! }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await db.delete(schema.user).where(eq(schema.user.id, OWNER));
    await db.insert(schema.user).values({
      id: OWNER,
      name: 'Owner',
      email: 'lfs-owner@example.com',
      username: 'lfs-owner',
    });
    [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'lfs',
        slug: 'lfs',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();
    const config = new ConfigService({
      BETTER_AUTH_URL: 'http://ghost.test',
      BETTER_AUTH_SECRET: 'secret',
    });
    s3 = new InMemoryS3();
    lfs = new LfsService(
      db,
      s3 as unknown as S3Service,
      new StorageQuotaService(db, config),
      config,
    );
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, OWNER));
    await pool?.end();
  });

  it('leaves the upload that took over a lapsed reservation alone when the lapsed one fails', async () => {
    const file = randomBytes(64);
    const oid = createHash('sha256').update(file).digest('hex');
    const upload = (body: PassThrough) =>
      lfs.upload({ repository, oid, contentLength: '64', body });

    const stalled = new PassThrough();
    const first = upload(stalled);
    // Wait for its reservation, then age it past the TTL as a day-long stall would.
    await expect
      .poll(() => db.$count(schema.lfsObject, eq(schema.lfsObject.oid, oid)))
      .toBe(1);
    await db
      .update(schema.lfsObject)
      .set({ createdAt: sql`now() - interval '2 days'` })
      .where(eq(schema.lfsObject.oid, oid));

    const second = new PassThrough();
    second.end(file);
    await upload(second);

    stalled.end(randomBytes(64));
    await expect(first).rejects.toBeInstanceOf(LfsObjectMismatchError);

    expect(await lfs.find(repository.id, oid)).toEqual({ size: 64 });
    expect(s3.objects.get(lfsObjectKey(repository.id, oid))).toEqual(file);
    // Neither upload's staging object is left behind.
    expect([...s3.objects.keys()]).toEqual([lfsObjectKey(repository.id, oid)]);
    const [row] = await db
      .select({ uploadedAt: schema.lfsObject.uploadedAt })
      .from(schema.lfsObject)
      .where(
        and(
          eq(schema.lfsObject.repositoryId, repository.id),
          eq(schema.lfsObject.oid, oid),
        ),
      );
    expect(row.uploadedAt).not.toBeNull();
  });
});
