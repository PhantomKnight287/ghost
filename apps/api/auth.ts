/**
 * Static Better Auth instance for the `@better-auth/cli` only.
 *
 * The CLI (`bunx @better-auth/cli generate|migrate`) needs a top-level `auth`
 * export, which is exactly what the Nest DI setup avoids. So this file builds
 * its own short-lived connection; the running app never imports it and instead
 * gets its instance from `AuthModule.forRootAsync` in `src/app.module.ts`.
 *
 * Run it from the repo root so the root `.env` is picked up:
 *   bunx @better-auth/cli generate --config apps/api/auth.ts
 */
import { createDatabase } from '@ghost/db';

import { createAuth } from './src/lib/auth.js';

const { db } = createDatabase();

export const auth = createAuth(db, {
  secret: process.env.BETTER_AUTH_SECRET ?? 'cli-placeholder-secret',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
});
