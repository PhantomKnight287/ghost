import { verify } from 'node:crypto';

import { AppJwtError, JWT_EXPIRED, JWT_TOO_LONG } from './apps.errors.js';

/** How the GitHub auth middleware tells an app's JWT from an API key, which never starts with a base64url `{"`. */
export const APP_JWT = /^eyJ[\w-]*\.[\w-]+\.[\w-]*$/;

/** GitHub's limits: `iat` up to a minute ahead for clock drift, and a token that lives at most ten minutes. */
const CLOCK_DRIFT_SECONDS = 60;
const MAX_LIFETIME_SECONDS = 600;

export type AppJwtClaims = { iss: number; iat: number; exp: number };

/** The claims of an app JWT, read without trusting them: the caller looks up the app by `iss` and then calls `verifyAppJwt`. Only RS256 is accepted, so neither `none` nor an HMAC keyed with the public key can pass. */
export function decodeAppJwt(token: string): AppJwtClaims {
  const [header, payload] = token.split('.');
  let parsed: { header: { alg?: unknown }; claims: Record<string, unknown> };
  try {
    parsed = {
      header: JSON.parse(Buffer.from(header!, 'base64url').toString()),
      claims: JSON.parse(Buffer.from(payload!, 'base64url').toString()),
    };
  } catch {
    throw new AppJwtError();
  }
  const { iss, iat, exp } = parsed.claims ?? {};
  const appId =
    typeof iss === 'string' && /^\d+$/.test(iss) ? Number(iss) : iss;
  if (
    parsed.header?.alg !== 'RS256' ||
    !Number.isSafeInteger(appId) ||
    (appId as number) <= 0 ||
    !Number.isSafeInteger(iat)
  )
    throw new AppJwtError();
  if (!Number.isSafeInteger(exp)) throw new AppJwtError(JWT_EXPIRED);
  return { iss: appId as number, iat: iat as number, exp: exp as number };
}

/** Throws unless one of `publicKeys` signed `token` and its claims are within GitHub's time limits at `now`, in Unix seconds. */
export function verifyAppJwt(
  token: string,
  { iat, exp }: AppJwtClaims,
  publicKeys: string[],
  now: number,
) {
  const parts = token.split('.');
  const input = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2] ?? '', 'base64url');
  if (!publicKeys.some((key) => verify('sha256', input, key, signature)))
    throw new AppJwtError();
  if (exp <= now) throw new AppJwtError(JWT_EXPIRED);
  if (exp - iat > MAX_LIFETIME_SECONDS) throw new AppJwtError(JWT_TOO_LONG);
  if (iat > now + CLOCK_DRIFT_SECONDS) throw new AppJwtError();
}
