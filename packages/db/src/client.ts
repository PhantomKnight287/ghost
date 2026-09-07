import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(
  config: PoolConfig & { connectionString?: string } = {},
) {
  const connectionString = config.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ ...config, connectionString });
  const db = drizzle(pool, { schema });

  return { db, pool };
}

export type { Pool, PoolConfig } from "pg";
