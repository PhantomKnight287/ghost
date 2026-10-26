import type { Request } from 'express';

import { clientIp } from '../http/client-ip.js';

/** Who a request is counted as: the signed-in account however it signed in, else the client's address. */
export function rateLimitIdentity(
  request: Pick<Request, 'headers' | 'ip'> & {
    user?: { id: string } | null;
    githubViewer?: { userId: string } | null;
  },
) {
  const id = request.user?.id ?? request.githubViewer?.userId;
  return { signedIn: Boolean(id), key: id ?? clientIp(request) };
}
