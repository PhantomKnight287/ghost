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
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

  const host = process.env.GH_E2E_HOST;
  if (host) {
    const dir = path.resolve(import.meta.dirname, '../.gh-e2e');
    mkdirSync(dir, { recursive: true });
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        `/CN=${host}`,
        '-addext',
        // The IP lets supertest reach the same server at 127.0.0.1 while gh uses the host name.
        `subjectAltName=DNS:${host},IP:127.0.0.1`,
        '-keyout',
        path.join(dir, 'key.pem'),
        '-out',
        path.join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
  }
}
