import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";

import { type Config, loadConfig } from "./config.ts";
import { type Job, jobSchema, runImport } from "./import-job.ts";

export function createApp(config: Config, run: (job: Job) => Promise<void>) {
  const running = new Set<string>();
  const app = new Hono();

  app.get("/health", (c) => c.text("ok"));

  app.post(
    "/imports",
    bearerAuth({
      verifyToken: (token) => {
        const given = createHash("sha256").update(token).digest();
        const expected = createHash("sha256")
          .update(config.IMPORTER_SECRET)
          .digest();
        return timingSafeEqual(given, expected);
      },
    }),
    async (c) => {
      const parsed = jobSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid import job" }, 400);
      // A refused job is not lost: the API retries it with backoff.
      const job = parsed.data;
      // One attempt per import at a time: they share its working directory, and a superseded one stops at its next heartbeat.
      if (
        running.size >= config.IMPORTER_CONCURRENCY ||
        running.has(job.importId)
      )
        return c.json({ error: "Importer is busy" }, 503);

      running.add(job.importId);
      console.log(
        `import ${job.importId}: accepted ${job.source} -> ${job.destination}`,
      );
      void run(job).finally(() => running.delete(job.importId));
      return c.body(null, 202);
    },
  );

  return app;
}

if (import.meta.main) {
  const config = loadConfig(process.env);
  // A killed importer simply stops calling back; the API sees its leases lapse and dispatches those imports again.
  const app = createApp(config, (job) => runImport(job, config));
  Bun.serve({ port: config.PORT, fetch: app.fetch });
  console.log(`importer listening on :${config.PORT}`);
}
