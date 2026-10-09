import path from 'node:path';
import { createDatabase } from '@ghost/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../packages/db/drizzle',
);

/** Brings the test database up to date. Run once before any suite: two migrators racing on a fresh database collide creating the journal table. */
export async function migrateTestDatabase(connectionString: string) {
  const { db, pool } = createDatabase({ connectionString });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await pool.end();
}
