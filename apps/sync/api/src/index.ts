import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadConfig } from "./config.ts";
import * as schema from "./db/schema.ts";
import { createServer } from "./server.ts";

const config = loadConfig(process.env);
const server = createServer(config, drizzle(postgres(config.SYNC_DATABASE_URL), { schema }));
server.start();

export default { port: config.SYNC_PORT, fetch: server.app.fetch };
