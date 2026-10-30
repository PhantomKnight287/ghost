import { createHash } from 'node:crypto';

import { schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

import type { Executor } from '../db/executor.js';

/** GitHub's callback rule: same scheme, host and port as the registered callback, and a path equal to its path or under it. */
export function callbackMatches(registered: string, given: string) {
  if (given.includes('#')) return false;
  let callback: URL;
  let redirect: URL;
  try {
    callback = new URL(registered);
    redirect = new URL(given);
  } catch {
    return false;
  }
  if (redirect.username || redirect.password) return false;
  if (redirect.origin !== callback.origin) return false;
  const base = callback.pathname.endsWith('/')
    ? callback.pathname
    : `${callback.pathname}/`;
  return (
    redirect.pathname === callback.pathname ||
    redirect.pathname.startsWith(base)
  );
}

/** The redirect_uri the oauth-provider plugin issued `code` to, read without spending the code. The plugin keys a code by its sha256 in base64url and keeps the authorize query beside it. Null for an unknown code. */
export async function boundRedirectUri(
  db: Executor,
  code: string,
): Promise<string | null> {
  const [row] = await db
    .select({ value: schema.verification.value })
    .from(schema.verification)
    .where(
      eq(
        schema.verification.identifier,
        createHash('sha256').update(code).digest('base64url'),
      ),
    );
  if (!row) return null;
  try {
    const bound = (
      JSON.parse(row.value) as { query?: { redirect_uri?: unknown } }
    ).query?.redirect_uri;
    return typeof bound === 'string' ? bound : null;
  } catch {
    return null;
  }
}
