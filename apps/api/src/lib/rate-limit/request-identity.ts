import type { Request } from 'express';

import { clientIp } from '../http/client-ip.js';
import { secretsMatch } from '../http/secrets-match.js';

/** Who a request is counted as: the signed-in account however it signed in, else the client's address; and whether the web app sent it, proved by the secret it shares with the API. */
export function rateLimitIdentity(
  request: Pick<Request, 'headers' | 'ip'> & {
    user?: { id: string } | null;
    githubViewer?: { userId: string } | null;
  },
  webSecret: string | undefined,
) {
  const id = request.user?.id ?? request.githubViewer?.userId;
  const header = request.headers['x-ghost-web-secret'];
  return {
    signedIn: Boolean(id),
    key: id ?? clientIp(request),
    web: secretsMatch(
      typeof header === 'string' ? header : undefined,
      webSecret,
    ),
  };
}
