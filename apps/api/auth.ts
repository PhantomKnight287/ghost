/**
 * Static Better Auth instance for the `@better-auth/cli` only.
 *
 * The Better Auth CLI needs a top-level `auth` export, which Nest DI deliberately avoids. The running app never imports this; it gets its instance from `AuthModule.forRootAsync`.
 *
 * Run it from the repo root so the root `.env` is picked up: bunx @better-auth/cli generate --config apps/api/auth.ts
 */
import { createDatabase } from '@ghost/db';

import { createAuth } from './src/lib/auth.js';

const { db } = createDatabase();

export const auth = createAuth(db, {
  secret: process.env.BETTER_AUTH_SECRET ?? 'cli-placeholder-secret',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
});
