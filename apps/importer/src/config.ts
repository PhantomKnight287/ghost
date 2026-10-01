import os from "node:os";
import path from "node:path";
import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3004),
  IMPORTER_SECRET: z.string().min(16),
  // Where the importer reaches the API, for its callbacks and for `git push`. Inside a private network this is the internal name, not the public origin.
  GHOST_API_URL: z.url(),
  IMPORTER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  IMPORTER_WORKDIR: z
    .string()
    .default(path.join(os.tmpdir(), "ghost-importer")),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid importer configuration: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
