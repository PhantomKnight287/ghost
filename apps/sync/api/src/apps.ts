import { createSign } from "node:crypto";

const REFRESH_BEFORE_EXPIRY_MS = 300_000;
const MINT_TIMEOUT_MS = 30_000;

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function createAppAuth({
  appId,
  privateKey,
  apiUrl,
  fetch = globalThis.fetch,
  now = Date.now,
}: {
  appId: number;
  privateKey: string;
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}) {
  const tokens = new Map<number, { token: string; expiresAt: number }>();
  // Callers asking at once share one mint instead of each spending a token.
  const minting = new Map<number, Promise<string>>();

  const jwt = () => {
    const seconds = Math.floor(now() / 1000);
    // iat is backdated to absorb clock drift; GitHub caps exp at 10 minutes after iat.
    const unsigned = `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url({ iss: String(appId), iat: seconds - 60, exp: seconds + 540 })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
    return `${unsigned}.${signature}`;
  };

  const mint = async (installationId: number) => {
    const response = await fetch(`${apiUrl}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt()}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Minting a token for installation ${installationId} failed with ${response.status}: ${text.slice(0, 200)}`);
    const { token, expires_at } = JSON.parse(text) as { token: string; expires_at: string };
    tokens.set(installationId, { token, expiresAt: Date.parse(expires_at) });
    return token;
  };

  const installationToken = async (installationId: number) => {
    const cached = tokens.get(installationId);
    if (cached && now() < cached.expiresAt - REFRESH_BEFORE_EXPIRY_MS) return cached.token;
    const pending = minting.get(installationId) ?? mint(installationId).finally(() => minting.delete(installationId));
    minting.set(installationId, pending);
    return pending;
  };

  return { jwt, installationToken };
}
