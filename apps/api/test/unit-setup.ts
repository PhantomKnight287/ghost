import { migrateTestDatabase } from './migrate.js';

// Integration specs share TEST_DATABASE_URL; migrating up front means none depends on another spec having migrated first.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (url) await migrateTestDatabase(url);
}
