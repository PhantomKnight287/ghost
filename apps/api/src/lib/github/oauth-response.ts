import type { Request, Response } from 'express';

/** GitHub answers its OAuth endpoints form-encoded unless the client asks for JSON; gh's client reads either. */
export function sendOAuth(
  req: Request,
  res: Response,
  status: number,
  body: Record<string, string | number>,
) {
  res.status(status).setHeader('Cache-Control', 'no-store');
  if (/application\/json/.test(req.headers.accept ?? '')) return res.json(body);
  res
    .type('application/x-www-form-urlencoded')
    .send(
      new URLSearchParams(
        Object.entries(body).map(([key, value]) => [key, String(value)]),
      ).toString(),
    );
}
