import type { Request } from 'express';

/** The address a request came from, read the way Better Auth reads it: Railway's edge sets `X-Real-IP`, and elsewhere Caddy replaces `X-Forwarded-For` with the client's address. The web server forwards both when it calls the API for a page. */
// ponytail: trusts X-Forwarded-For off Railway, which only Caddy in front makes safe; an API exposed without a proxy would need `trust proxy` and req.ip instead.
export function clientIp(
  request: Pick<Request, 'headers' | 'ip'>,
  onRailway = Boolean(process.env.RAILWAY_SERVICE_ID),
) {
  const header = request.headers[onRailway ? 'x-real-ip' : 'x-forwarded-for'];
  const first = (Array.isArray(header) ? header[0] : header)
    ?.split(',')[0]
    ?.trim();
  return first || request.ip || 'unknown';
}
