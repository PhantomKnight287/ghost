import type { Auth } from '../auth.js';
import { ApiKeyRateLimitedError } from './api-keys.errors.js';

export const API_KEY_REQUESTS_PER_MINUTE = 120;

/** The key behind `key`, or null when there is none; a good key over its budget throws instead, because Better Auth reports that as `valid: false` too. */
export async function verifyApiKey(
  api: Pick<Auth['api'], 'verifyApiKey'>,
  key: string,
) {
  const result = await api.verifyApiKey({ body: { key } });
  if (result.error?.code === 'RATE_LIMITED') {
    // The error's type leaves out `details`, which the plugin spreads in from its APIError body.
    const { details } = result.error as { details?: { tryAgainIn?: number } };
    throw new ApiKeyRateLimitedError(
      API_KEY_REQUESTS_PER_MINUTE,
      details?.tryAgainIn ?? 0,
    );
  }
  return result.valid ? result.key : null;
}
