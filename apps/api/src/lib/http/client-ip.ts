import type { Request } from 'express';

/** The address a request came from: Railway's edge sets `X-Real-IP`; elsewhere `req.ip` reads `X-Forwarded-For` only from the proxies `trust proxy` names. The web server forwards both when it calls the API for a page. */
export function clientIp(
  request: Pick<Request, 'headers' | 'ip'>,
  onRailway = Boolean(process.env.RAILWAY_SERVICE_ID),
) {
  const header = onRailway ? request.headers['x-real-ip'] : undefined;
  const first = (Array.isArray(header) ? header[0] : header)
    ?.split(',')[0]
    ?.trim();
  return first || request.ip || 'unknown';
}
