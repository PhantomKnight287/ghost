import { type Database, schema } from '@ghost/db';
import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AllowAnonymous, AuthService } from '@thallesp/nestjs-better-auth';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';

import { DATABASE } from '../../database/database.module.js';
import type { Auth } from '../../lib/auth.js';
import { oauthAppOf } from '../../lib/github/oauth-apps.js';
import { sendOAuth } from '../../lib/github/oauth-response.js';
import { grantableScopes } from '../../lib/github/scopes.js';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** GitHub's OAuth device flow at its own paths, translated onto Better Auth's deviceAuthorization plugin. */
@Controller('login')
@ApiExcludeController()
@AllowAnonymous()
export class OauthController {
  constructor(
    private readonly auth: AuthService<Auth>,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Post('device/code')
  async deviceCode(
    @Body() body: { client_id?: string; scope?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!body.client_id || !oauthAppOf(body.client_id))
      return sendOAuth(req, res, 400, {
        error: 'unauthorized_client',
        error_description: 'Unknown client_id',
      });
    const code = await this.auth.api.deviceCode({
      body: {
        client_id: body.client_id,
        scope: grantableScopes(body.scope ?? '').join(' '),
      },
    });
    sendOAuth(req, res, 200, {
      device_code: code.device_code,
      user_code: code.user_code,
      verification_uri: code.verification_uri,
      expires_in: code.expires_in,
      interval: code.interval,
    });
  }

  @Post('oauth/access_token')
  async accessToken(
    @Body()
    body: { client_id?: string; device_code?: string; grant_type?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // ponytail: the device grant only; plan 3 adds grant_type=authorization_code for user-registered apps.
    if (
      body.grant_type !== DEVICE_GRANT ||
      !body.client_id ||
      !body.device_code
    )
      return sendOAuth(req, res, 400, { error: 'unsupported_grant_type' });
    const app = oauthAppOf(body.client_id);
    if (!app) return sendOAuth(req, res, 400, { error: 'invalid_client' });

    let granted: { access_token: string; scope: string };
    try {
      granted = await this.auth.api.deviceToken({
        body: {
          grant_type: DEVICE_GRANT,
          device_code: body.device_code,
          client_id: body.client_id,
        },
      });
    } catch (error) {
      if (!(error instanceof APIError)) throw error;
      // GitHub answers pending, slow_down, expired and denied with 200 and `error` in the body; gh reads the body, not the status.
      const { error: code, error_description } = error.body as {
        error?: string;
        error_description?: string;
      };
      return sendOAuth(req, res, 200, {
        error: code ?? 'invalid_grant',
        ...(error_description && { error_description }),
      });
    }

    // The plugin answers with a browser session; gh gets a scoped API key instead, and the session is ended.
    const [session] = await this.db
      .delete(schema.session)
      .where(eq(schema.session.token, granted.access_token))
      .returning({ userId: schema.session.userId });
    if (!session) return sendOAuth(req, res, 200, { error: 'invalid_grant' });
    const scopes = grantableScopes(granted.scope);
    const { key } = await this.auth.api.createApiKey({
      body: {
        userId: session.userId,
        name: app.name,
        permissions: { scopes },
        metadata: { oauthClientId: app.clientId },
      },
    });
    sendOAuth(req, res, 200, {
      access_token: key,
      token_type: 'bearer',
      scope: scopes.join(','),
    });
  }
}
