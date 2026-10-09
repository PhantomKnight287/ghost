import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  DATABASE_URL,
  hasBackends,
  S3_ENDPOINT,
  s3Credentials,
} from './harness.js';
import { migrateTestDatabase } from './migrate.js';

export default async function setup() {
  if (!hasBackends || !DATABASE_URL) return;

  await migrateTestDatabase(DATABASE_URL);

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
