import { createHash, timingSafeEqual } from 'node:crypto';

/** Compares a secret a caller sent with the configured one in constant time; an unset secret matches nothing. */
export function secretsMatch(
  given: string | undefined,
  expected: string | undefined,
) {
  if (!given || !expected) return false;
  // Hashing first gives both sides one length, which `timingSafeEqual` needs.
  return timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(expected).digest(),
  );
}
