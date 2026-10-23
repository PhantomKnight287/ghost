import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "./client.js";
import { seedBuiltInRows } from "./seed.js";

// Drizzle runs each migration batch in one transaction, so a failed attempt leaves nothing half-applied to retry over.
const MAX_RETRIES = 3;
// Every API instance migrates on start; the lock makes a second one wait, then find nothing left to apply.
const MIGRATION_LOCK = 7_034_201;

async function main() {
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "drizzle",
  );

  const { db, pool } = createDatabase();
  const lock = await pool.connect();

  try {
    await lock.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    for (let attempt = 0; ; attempt++) {
      try {
        await migrate(db, { migrationsFolder });
        break;
      } catch (error) {
        if (attempt >= MAX_RETRIES) throw error;
        const delay = 1_000 * 2 ** attempt;
        console.warn(
          `Migration failed, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${(error as Error).message}`,
        );
        await sleep(delay);
      }
    }
    console.log(`Migrations applied from ${migrationsFolder}`);
    await seedBuiltInRows(db);
  } finally {
    lock.release();
    await pool.end();
  }
}

await main();
