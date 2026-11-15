import { createSign } from "node:crypto";

const REFRESH_BEFORE_EXPIRY_MS = 300_000;

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

  const jwt = () => {
    const seconds = Math.floor(now() / 1000);
    // iat is backdated to absorb clock drift; GitHub caps exp at 10 minutes after iat.
    const unsigned = `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url({ iss: String(appId), iat: seconds - 60, exp: seconds + 540 })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
    return `${unsigned}.${signature}`;
  };

  const installationToken = async (installationId: number) => {
    const cached = tokens.get(installationId);
    if (cached && now() < cached.expiresAt - REFRESH_BEFORE_EXPIRY_MS) return cached.token;

    const response = await fetch(`${apiUrl}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt()}`, accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`Minting a token for installation ${installationId} failed with ${response.status}`);

    const { token, expires_at } = (await response.json()) as { token: string; expires_at: string };
    tokens.set(installationId, { token, expiresAt: Date.parse(expires_at) });
    return token;
  };

  return { jwt, installationToken };
}
