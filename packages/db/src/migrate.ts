import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "./client.js";

// Drizzle runs each migration batch in one transaction, so a failed attempt leaves nothing half-applied to retry over.
const MAX_RETRIES = 3;

async function main() {
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "drizzle",
  );

  const { db, pool } = createDatabase();

  try {
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
  } finally {
    await pool.end();
  }
}

await main();
