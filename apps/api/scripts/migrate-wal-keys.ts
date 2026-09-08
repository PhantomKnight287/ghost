/**
 * Moves every write-ahead log from the old `repos/<username>/<slug>` keyspace to
 * `repos/<repositoryId>`, which is what the transport reads since repository ids
 * replaced name pairs.
 *
 * A log left behind is invisible to the API: `readIndex` returns null, the cache
 * replays an empty index, and the repository serves as freshly initialised.
 *
 * Entries are copied before the index that names them, so an interrupted run
 * leaves the new prefix either absent or complete, never pointing at packs that
 * have not landed. Old keys are kept unless `--prune` is passed.
 *
 *   bun scripts/migrate-wal-keys.ts [--apply] [--prune]
 */
import { S3 } from '@aws-sdk/client-s3';
import { createDatabase, schema } from '@ghost/db';
import { eq, isNotNull } from 'drizzle-orm';

const apply = process.argv.includes('--apply');
const prune = process.argv.includes('--prune');

const bucket = required('S3_BUCKET');
const s3 = new S3({
  forcePathStyle: true,
  endpoint: required('S3_ENDPOINT'),
  region: 'auto',
  credentials: {
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
});

const { db, pool } = createDatabase({
  connectionString: required('DATABASE_URL'),
});

const rows = await db
  .select({
    id: schema.repository.id,
    username: schema.user.username,
    slug: schema.repository.slug,
  })
  .from(schema.repository)
  .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
  .where(isNotNull(schema.user.username));

let moved = 0;
let skipped = 0;

for (const { id, username, slug } of rows) {
  const from = `${username}/${slug}`;
  const label = `${from} -> ${id}`;

  if (await exists(`repos/${id}/index`)) {
    skipped++;
    continue;
  }
  if (!(await exists(`repos/${from}/index`))) {
    console.log(`no log        ${label}`);
    skipped++;
    continue;
  }

  const keys = await listPrefix(`repos/${from}/`);
  const entries = keys.filter((key) => key.includes('/entries/'));

  console.log(`${apply ? 'migrating' : 'would move'}   ${label}  (${keys.length} objects)`);
  if (!apply) {
    moved++;
    continue;
  }

  for (const key of entries) {
    await s3.copyObject({
      Bucket: bucket,
      Key: key.replace(`repos/${from}/`, `repos/${id}/`),
      CopySource: `${bucket}/${key}`,
    });
  }

  await s3.copyObject({
    Bucket: bucket,
    Key: `repos/${id}/index`,
    CopySource: `${bucket}/repos/${from}/index`,
  });

  if (prune) {
    for (const key of keys) {
      await s3.deleteObject({ Bucket: bucket, Key: key });
    }
  }

  moved++;
}

console.log(
  `\n${apply ? 'migrated' : 'to migrate'}: ${moved}, skipped: ${skipped}` +
    (apply ? '' : '\nre-run with --apply to write, and --prune to drop old keys'),
);

await pool.end();

async function exists(key: string) {
  try {
    await s3.headObject({ Bucket: bucket, Key: key });
    return true;
  } catch {
    return false;
  }
}

async function listPrefix(prefix: string) {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const page = await s3.listObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    });
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    token = page.NextContinuationToken;
  } while (token);

  return keys;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
