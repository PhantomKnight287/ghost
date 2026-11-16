import { drizzle } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import postgres from "postgres";
import { createAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import * as schema from "./db/schema.ts";

const config = loadConfig(process.env);
const db = drizzle(postgres(config.SYNC_DATABASE_URL), { schema });
const auth = createAuth(db, config);

const app = new Hono();
app.use("/api/*", cors({ origin: config.SYNC_WEB_URL, credentials: true, allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.get("/health", (c) => c.text("ok"));

export default { port: config.SYNC_PORT, fetch: app.fetch };
