import { createHmac, timingSafeEqual } from 'node:crypto';

/** What `git-lfs-authenticate` grants: one user, one repository, one operation, until `expiresAt` (epoch ms). */
export interface LfsTokenClaims {
  userId: string;
  repositoryId: string;
  operation: 'download' | 'upload';
  expiresAt: number;
}

function signature(secret: string, payload: string) {
  return createHmac('sha256', secret).update(`lfs-token:${payload}`).digest();
}

export function signLfsToken(secret: string, claims: LfsTokenClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${signature(secret, payload).toString('base64url')}`;
}

/** The claims of a token this secret signed and that has not expired, or null. */
export function verifyLfsToken(
  secret: string,
  token: string,
  now = Date.now(),
): LfsTokenClaims | null {
  const [payload, signed] = token.split('.');
  if (!payload || !signed) return null;
  const expected = signature(secret, payload);
  const actual = Buffer.from(signed, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  const claims = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as LfsTokenClaims;
  return claims.expiresAt > now ? claims : null;
}
