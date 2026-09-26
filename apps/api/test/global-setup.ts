import path from 'node:path';
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createDatabase } from '@ghost/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import {
  DATABASE_URL,
  hasBackends,
  S3_ENDPOINT,
  s3Credentials,
} from './harness.js';

const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../packages/db/drizzle',
);

// Once for every suite: suites run in parallel, and two migrators racing on a fresh database collide creating the journal table.
export default async function setup() {
  if (!hasBackends) return;

  const { db, pool } = createDatabase({ connectionString: DATABASE_URL });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await pool.end();

  await new S3Client({
    endpoint: S3_ENDPOINT,
    region: 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3Credentials.S3_ACCESS_KEY_ID,
      secretAccessKey: s3Credentials.S3_SECRET_ACCESS_KEY,
    },
  })
    .send(new CreateBucketCommand({ Bucket: s3Credentials.S3_BUCKET }))
    .catch((error: unknown) => {
      if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
    });
}
