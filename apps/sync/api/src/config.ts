import { z } from 'zod'

const configSchema = z.object({
  SYNC_DATABASE_URL: z.string(),
  SYNC_AUTH_SECRET: z.string(),
  SYNC_API_URL: z.string(),
  SYNC_WEB_URL: z.string(),
  GHOST_API_URL: z.string(),
  GHOST_WEB_URL: z.string(),
  GHOST_APP_ID: z.coerce.number(),
  GHOST_APP_SLUG: z.string(),
  GHOST_APP_PRIVATE_KEY: z.string() .transform((val) => val.replace(/\\n/g, "\n")),
  GHOST_APP_CLIENT_ID: z.string(),
  GHOST_APP_CLIENT_SECRET: z.string(),
  GHOST_APP_WEBHOOK_SECRET: z.string(),
  GITHUB_APP_ID: z.coerce.number(),
  GITHUB_APP_SLUG: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string() .transform((val) => val.replace(/\\n/g, "\n")),
  GITHUB_APP_CLIENT_ID: z.string(),
  GITHUB_APP_CLIENT_SECRET: z.string(),
  GITHUB_APP_WEBHOOK_SECRET: z.string(),
  SYNC_PORT: z.coerce.number().default(3006),
  RECONCILE_INTERVAL: z.coerce.number().default(600),
  SYNC_DATA_DIR: z.string().default("/data"),
});

export type Config = z.infer<typeof configSchema>
export function loadConfig(env: Record<string, string | undefined>): Config {
  const safeParsed = configSchema.safeParse(env)
  if (safeParsed.success === false) {
    const treeifyErrors = z.treeifyError(safeParsed.error)
    const firstKey = Object.keys(treeifyErrors.properties!)[0] as keyof typeof treeifyErrors.properties
    throw new Error(`${firstKey}: ${(treeifyErrors.properties![firstKey] as {errors:string[]}).errors?.[0]}`);
  }

  return safeParsed.data
};
