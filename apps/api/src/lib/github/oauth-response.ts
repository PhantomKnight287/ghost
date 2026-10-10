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

/** What each OAuth error Ghost answers itself means, in GitHub's wording where GitHub has one, so a client that shows `error_description` tells its user what went wrong. */
const OAUTH_ERROR_DESCRIPTIONS = {
  incorrect_client_credentials:
    'The client_id and/or client_secret passed are incorrect.',
  redirect_uri_mismatch:
    'The redirect_uri MUST match the registered callback URL for this application.',
  bad_verification_code: 'The code passed is incorrect or expired.',
  bad_refresh_token: 'The refresh token passed is incorrect or expired.',
  unsupported_grant_type:
    'Send a code, a device_code with the device grant_type, or a refresh_token with grant_type=refresh_token.',
  invalid_client: 'No OAuth app is registered with this client_id.',
  unauthorized_client:
    'No OAuth app with device flow enabled is registered with this client_id.',
  invalid_grant: 'The device code is incorrect or expired.',
} as const;

export type OAuthError = keyof typeof OAUTH_ERROR_DESCRIPTIONS;

export function sendOAuthError(
  req: Request,
  res: Response,
  status: number,
  error: OAuthError,
) {
  sendOAuth(req, res, status, {
    error,
    error_description: OAUTH_ERROR_DESCRIPTIONS[error],
  });
}
