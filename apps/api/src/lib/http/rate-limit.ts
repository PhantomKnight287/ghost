import type { Request } from 'express';

import { API_KEY_REQUESTS_PER_MINUTE } from '../api-keys/verify-api-key.js';
import { clientIp } from './client-ip.js';

// Signed-in callers get the budget Better Auth's apiKey plugin gives a key; anonymous callers share an address, so they get less.
const ANONYMOUS_PER_MINUTE = 30;

/** What the global auth guard leaves on the request: the account behind a session or an API key, or null. */
type AuthedRequest = Pick<Request, 'headers' | 'ip'> & {
  user?: { id: string } | null;
};

/** Signed-in callers are counted per account, so rotating addresses buys nothing; everyone else per address. */
export function rateLimitTracker(request: AuthedRequest) {
  return request.user ? `user:${request.user.id}` : `ip:${clientIp(request)}`;
}

export function rateLimitPerMinute(request: AuthedRequest) {
  return request.user ? API_KEY_REQUESTS_PER_MINUTE : ANONYMOUS_PER_MINUTE;
}
