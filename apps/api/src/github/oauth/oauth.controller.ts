import { type Database, schema } from '@ghost/db';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AllowAnonymous, AuthService } from '@thallesp/nestjs-better-auth';
import { isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';

import { DATABASE } from '../../database/database.module.js';
import type { Auth } from '../../lib/auth.js';
import type { Executor } from '../../lib/db/executor.js';
import { callbackMatches } from '../../lib/github/callback.js';
import { findOauthApp, type OauthApp } from '../../lib/github/oauth-apps.js';
import { sendOAuth } from '../../lib/github/oauth-response.js';
import {
  ACCESS_TOKEN_EXPIRES_IN,
  issueRefreshToken,
  REFRESH_TOKEN_EXPIRES_IN,
  spendRefreshToken,
} from '../../lib/github/refresh-tokens.js';
import { grantableScopes, NO_SCOPE } from '../../lib/github/scopes.js';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Fixed text only: nothing from the request reaches the page. */
const authorizeErrorPage = (message: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Authorization failed</title></head><body><h1>Authorization failed</h1><p>${message}</p></body></html>`;

/** GitHub's OAuth flows at its own paths: the device flow over Better Auth's deviceAuthorization plugin, the web flow over the oauth-provider plugin. */
@Controller('login')
@ApiExcludeController()
@AllowAnonymous()
export class OauthController {
  constructor(
    private readonly auth: AuthService<Auth>,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** Checks the app and its callback before anything redirects, so a bad request never leaves the API host. */
  @Get('oauth/authorize')
  async authorize(
    @Query()
    query: {
      client_id?: string;
      redirect_uri?: string;
      scope?: string;
      state?: string;
      code_challenge?: string;
      code_challenge_method?: string;
    },
    @Res() res: Response,
  ) {
    const app = query.client_id
      ? await findOauthApp(this.db, query.client_id)
      : null;
    if (!app)
      return res
        .status(400)
        .type('html')
        .send(authorizeErrorPage('This application is not registered.'));
    const redirectUri = query.redirect_uri ?? app.redirectUris[0];
    if (
      !redirectUri ||
      !app.redirectUris.some((callback) =>
        callbackMatches(callback, redirectUri),
      )
    )
      return res
        .status(400)
        .type('html')
        .send(
          authorizeErrorPage(
            'The redirect_uri is not associated with this application.',
          ),
        );
    // GitHub reads commas as separators too.
    const scopes = grantableScopes((query.scope ?? '').replaceAll(',', ' '));
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: app.clientId,
      redirect_uri: redirectUri,
      scope: scopes.length ? scopes.join(' ') : NO_SCOPE,
      ...(query.state && { state: query.state }),
      ...(query.code_challenge && { code_challenge: query.code_challenge }),
      ...(query.code_challenge_method && {
        code_challenge_method: query.code_challenge_method,
      }),
    });
    res.redirect(302, `/api/auth/oauth2/authorize?${params}`);
  }

  @Post('device/code')
  async deviceCode(
    @Body() body: { client_id?: string; scope?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const app = body.client_id && (await findOauthApp(this.db, body.client_id));
    if (!app || !app.deviceFlowEnabled)
      return sendOAuth(req, res, 400, {
        error: 'unauthorized_client',
        error_description: 'Unknown client_id',
      });
    const code = await this.auth.api.deviceCode({
      body: {
        client_id: app.clientId,
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

  /** Dispatches as GitHub does: the device and refresh grants when `grant_type` names them, the web flow's code exchange when a `code` is sent, which GitHub's clients send without a `grant_type`. */
  @Post('oauth/access_token')
  async accessToken(
    @Body()
    body: {
      client_id?: string;
      client_secret?: string;
      device_code?: string;
      grant_type?: string;
      code?: string;
      redirect_uri?: string;
      code_verifier?: string;
      refresh_token?: string;
    },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const app = body.client_id
      ? await findOauthApp(this.db, body.client_id)
      : null;
    if (body.grant_type === DEVICE_GRANT && body.device_code) {
      if (!app) return sendOAuth(req, res, 400, { error: 'invalid_client' });
      return this.deviceGrant(req, res, app, body.device_code);
    }
    if (
      body.grant_type === 'refresh_token' &&
      typeof body.refresh_token === 'string'
    ) {
      if (!app)
        return sendOAuth(req, res, 200, {
          error: 'incorrect_client_credentials',
        });
      return this.refreshGrant(req, res, app, {
        client_secret: body.client_secret,
        refresh_token: body.refresh_token,
      });
    }
    if (body.code) {
      if (!app)
        return sendOAuth(req, res, 200, {
          error: 'incorrect_client_credentials',
        });
      return this.codeGrant(req, res, app, { ...body, code: body.code });
    }
    sendOAuth(req, res, 400, { error: 'unsupported_grant_type' });
  }

  private async deviceGrant(
    req: Request,
    res: Response,
    app: OauthApp,
    deviceCode: string,
  ) {
    let granted: { access_token: string; scope: string };
    try {
      granted = await this.auth.api.deviceToken({
        body: {
          grant_type: DEVICE_GRANT,
          device_code: deviceCode,
          client_id: app.clientId,
        },
      });
    } catch (error) {
      if (!isAPIError(error)) throw error;
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
    return this.issueKey(req, res, app, session.userId, granted.scope);
  }

  private async codeGrant(
    req: Request,
    res: Response,
    app: OauthApp,
    body: {
      client_secret?: string;
      code: string;
      redirect_uri?: string;
      code_verifier?: string;
    },
  ) {
    const redirectUri = body.redirect_uri ?? app.redirectUris[0];
    if (
      !redirectUri ||
      !app.redirectUris.some((callback) =>
        callbackMatches(callback, redirectUri),
      )
    )
      return sendOAuth(req, res, 200, { error: 'redirect_uri_mismatch' });
    const client = {
      client_id: app.clientId,
      client_secret: body.client_secret,
    };
    let granted: { access_token: string; scope: string };
    try {
      granted = await this.auth.api.oauth2Token({
        body: {
          ...client,
          grant_type: 'authorization_code',
          code: body.code,
          redirect_uri: redirectUri,
          code_verifier: body.code_verifier,
        },
      });
    } catch (error) {
      if (!isAPIError(error)) throw error;
      const { error: code } = error.body as { error?: string };
      return sendOAuth(req, res, 200, {
        error:
          code === 'invalid_client'
            ? 'incorrect_client_credentials'
            : 'bad_verification_code',
      });
    }

    // The plugin's token is never handed out: Ghost reads whose it is, revokes it, and mints a key in its place.
    const token = {
      ...client,
      token: granted.access_token,
      token_type_hint: 'access_token' as const,
    };
    const { sub } = await this.auth.api.oauth2Introspect({ body: token });
    await this.auth.api.oauth2Revoke({ body: token });
    return this.issueKey(req, res, app, sub as string, granted.scope);
  }

  /** The new pair is minted under the app's current switch, so turning it off moves the app to keys that never expire on its next refresh. The old key goes only once the new pair exists. */
  private async refreshGrant(
    req: Request,
    res: Response,
    app: OauthApp,
    body: { client_secret?: unknown; refresh_token: string },
  ) {
    if (
      typeof body.client_secret !== 'string' ||
      !(await this.authenticates(app, body.client_secret))
    )
      return sendOAuth(req, res, 200, {
        error: 'incorrect_client_credentials',
      });
    const refreshToken = body.refresh_token;
    const token = await this.db.transaction(async (tx) => {
      const grant = await spendRefreshToken(tx, app.clientId, refreshToken);
      if (!grant) return null;
      const minted = await this.mint(app, grant.userId, grant.scopes, tx);
      await tx
        .delete(schema.apikey)
        .where(eq(schema.apikey.id, grant.accessKeyId));
      return minted;
    });
    if (!token)
      return sendOAuth(req, res, 200, {
        error: 'bad_refresh_token',
        error_description: 'The refresh token passed is incorrect or expired.',
      });
    sendOAuth(req, res, 200, token);
  }

  /** The plugin checks a secret its own way; introspecting a token it does not hold fails only on bad credentials. */
  private async authenticates(app: OauthApp, clientSecret: string) {
    try {
      await this.auth.api.oauth2Introspect({
        body: {
          client_id: app.clientId,
          client_secret: clientSecret,
          token: 'ghost-client-check',
          token_type_hint: 'access_token',
        },
      });
      return true;
    } catch (error) {
      if (
        isAPIError(error) &&
        (error.body as { error?: string }).error === 'invalid_client'
      )
        return false;
      throw error;
    }
  }

  private async issueKey(
    req: Request,
    res: Response,
    app: OauthApp,
    userId: string,
    scope: string,
  ) {
    sendOAuth(
      req,
      res,
      200,
      await this.mint(app, userId, grantableScopes(scope)),
    );
  }

  /** One token response for every grant, so the device flow, the code exchange and a refresh answer alike. */
  private async mint(
    app: OauthApp,
    userId: string,
    scopes: string[],
    executor: Executor = this.db,
  ) {
    const { key, id } = await this.auth.api.createApiKey({
      body: {
        userId,
        name: app.name,
        permissions: { scopes },
        metadata: { oauthClientId: app.clientId },
        ...(app.expireUserTokens && { expiresIn: ACCESS_TOKEN_EXPIRES_IN }),
      },
    });
    const token = {
      access_token: key,
      token_type: 'bearer',
      scope: scopes.join(','),
    };
    if (!app.expireUserTokens) return token;
    return {
      ...token,
      expires_in: ACCESS_TOKEN_EXPIRES_IN,
      refresh_token: await issueRefreshToken(executor, app.clientId, {
        userId,
        scopes,
        accessKeyId: id,
      }),
      refresh_token_expires_in: REFRESH_TOKEN_EXPIRES_IN,
    };
  }
}
