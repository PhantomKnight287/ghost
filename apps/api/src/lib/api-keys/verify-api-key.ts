import type { Auth } from '../auth.js';

/** The key behind `key`, or null when there is none. */
export async function verifyApiKey(
  api: Pick<Auth['api'], 'verifyApiKey'>,
  key: string,
) {
  const result = await api.verifyApiKey({ body: { key } });
  return result.valid ? result.key : null;
}
