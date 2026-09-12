import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "./client.js";

/**
 * Applies the committed SQL migrations. Runs from the built output, so the
 * folder is resolved relative to `dist/`, not the working directory.
 */
async function main() {
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "drizzle",
  );

  const { db, pool } = createDatabase();

  try {
    await migrate(db, { migrationsFolder });
    console.log(`Migrations applied from ${migrationsFolder}`);
  } finally {
    await pool.end();
  }
}

await main();
