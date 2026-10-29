import type { Auth } from '../auth.js';

/** The key behind `key`, or null when there is none. A bot's key is none: a bot acts only through its app's tokens. */
export async function verifyApiKey(
  auth: { api: Pick<Auth['api'], 'verifyApiKey'>; $context: Auth['$context'] },
  key: string,
) {
  const result = await auth.api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) return null;
  const { internalAdapter } = await auth.$context;
  const owner = await internalAdapter.findUserById(result.key.referenceId);
  return (owner as { kind?: string } | null)?.kind === 'bot'
    ? null
    : result.key;
}
