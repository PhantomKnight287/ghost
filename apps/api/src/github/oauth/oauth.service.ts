import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { Auth } from '../../lib/auth.js';
import type { Executor } from '../../lib/db/executor.js';
import { callbackMatches } from '../../lib/github/callback.js';
import { findOauthApp, type OauthApp } from '../../lib/github/oauth-apps.js';
import {
  type OAuthReply,
  oauthError,
} from '../../lib/github/oauth-response.js';
import {
  ACCESS_TOKEN_EXPIRES_IN,
  issueRefreshToken,
  REFRESH_TOKEN_EXPIRES_IN,
  spendRefreshToken,
} from '../../lib/github/refresh-tokens.js';
import { grantableScopes, NO_SCOPE } from '../../lib/github/scopes.js';
import { generateUserRefreshToken } from '../../lib/apps/user-token.js';
import { AppClientsService } from '../../services/apps/app-clients.service.js';
import { UserTokensService } from '../../services/apps/user-tokens.service.js';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export type AuthorizeQuery = {
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  prompt?: string;
};

export type AccessTokenRequest = {
  client_id?: string;
  client_secret?: string;
  device_code?: string;
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  code_verifier?: string;
  refresh_token?: string;
};

/** GitHub's OAuth flows: the device flow over Better Auth's deviceAuthorization plugin, the web flow over the oauth-provider plugin. Every grant ends in a scoped API key, never the plugins' own tokens. */
@Injectable()
export class OauthService {
  constructor(
    private readonly auth: AuthService<Auth>,
    @Inject(DATABASE) private readonly db: Database,
    private readonly appClients: AppClientsService,
    private readonly userTokens: UserTokensService,
  ) {}

  /** Where to send the browser, or why not: the app and its callback are checked before anything redirects, so a bad request never leaves the API host. */
  async authorize(
    query: AuthorizeQuery,
  ): Promise<{ redirect: string } | { refused: string }> {
    const app = query.client_id
      ? await findOauthApp(this.db, query.client_id)
      : null;
    if (!app) return { refused: 'This application is not registered.' };
    const redirectUri = query.redirect_uri ?? app.redirectUris[0];
    if (
      !redirectUri ||
      !app.redirectUris.some((callback) =>
        callbackMatches(callback, redirectUri),
      )
    )
      return {
        refused: 'The redirect_uri is not associated with this application.',
      };
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
      // `consent` asks again even after an earlier approval; the plugin reads the rest of OIDC's values too and ignores unknown ones.
      ...(query.prompt && { prompt: query.prompt }),
    });
    return { redirect: `/api/auth/oauth2/authorize?${params}` };
  }

  async deviceCode(body: {
    client_id?: string;
    scope?: string;
  }): Promise<OAuthReply> {
    const app = body.client_id && (await findOauthApp(this.db, body.client_id));
    if (!app || !app.deviceFlowEnabled)
      return oauthError(400, 'unauthorized_client');
    const code = await this.auth.api.deviceCode({
      body: {
        client_id: app.clientId,
        scope: grantableScopes(body.scope ?? '').join(' '),
      },
    });
    return {
      status: 200,
      body: {
        device_code: code.device_code,
        user_code: code.user_code,
        verification_uri: code.verification_uri,
        expires_in: code.expires_in,
        interval: code.interval,
      },
    };
  }

  /** Dispatches as GitHub does: the device and refresh grants when `grant_type` names them, the web flow's code exchange when a `code` is sent, which GitHub's clients send without a `grant_type`. */
  async accessToken(body: AccessTokenRequest): Promise<OAuthReply> {
    const app = body.client_id
      ? await findOauthApp(this.db, body.client_id)
      : null;
    if (body.grant_type === DEVICE_GRANT && body.device_code) {
      if (!app) return oauthError(400, 'invalid_client');
      return this.deviceGrant(app, body.device_code);
    }
    if (
      body.grant_type === 'refresh_token' &&
      typeof body.refresh_token === 'string'
    ) {
      if (!app) return oauthError(200, 'incorrect_client_credentials');
      return this.refreshGrant(app, {
        client_secret: body.client_secret,
        refresh_token: body.refresh_token,
      });
    }
    if (body.code) {
      if (!app) return oauthError(200, 'incorrect_client_credentials');
      return this.codeGrant(app, { ...body, code: body.code });
    }
    return oauthError(400, 'unsupported_grant_type');
  }

  private async deviceGrant(
    app: OauthApp,
    deviceCode: string,
  ): Promise<OAuthReply> {
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
      return {
        status: 200,
        body: {
          error: code ?? 'invalid_grant',
          ...(error_description && { error_description }),
        },
      };
    }

    // The plugin answers with a browser session; gh gets a scoped API key instead, and the session is ended.
    const [session] = await this.db
      .delete(schema.session)
      .where(eq(schema.session.token, granted.access_token))
      .returning({ userId: schema.session.userId });
    if (!session) return oauthError(200, 'invalid_grant');
    return {
      status: 200,
      body: await this.mint(
        app,
        session.userId,
        grantableScopes(granted.scope),
      ),
    };
  }

  private async codeGrant(
    app: OauthApp,
    body: {
      client_secret?: string;
      code: string;
      redirect_uri?: string;
      code_verifier?: string;
    },
  ): Promise<OAuthReply> {
    const redirectUri = body.redirect_uri ?? app.redirectUris[0];
    if (
      !redirectUri ||
      !app.redirectUris.some((callback) =>
        callbackMatches(callback, redirectUri),
      )
    )
      return oauthError(200, 'redirect_uri_mismatch');
    // For a Ghost App, Ghost checks the app's own secrets, then speaks to the plugin with the client's derived one.
    if (
      app.ghostAppId &&
      !(
        typeof body.client_secret === 'string' &&
        (await this.appClients.authenticate(app.clientId, body.client_secret))
      )
    )
      return oauthError(200, 'incorrect_client_credentials');
    const client = {
      client_id: app.clientId,
      client_secret: app.ghostAppId
        ? this.appClients.pluginSecretOf(app.clientId)
        : body.client_secret,
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
      return oauthError(
        200,
        code === 'invalid_client'
          ? 'incorrect_client_credentials'
          : 'bad_verification_code',
      );
    }

    // The plugin's token is never handed out: Ghost reads whose it is, revokes it, and mints a key in its place.
    const token = {
      ...client,
      token: granted.access_token,
      token_type_hint: 'access_token' as const,
    };
    const { sub } = await this.auth.api.oauth2Introspect({ body: token });
    await this.auth.api.oauth2Revoke({ body: token });
    return {
      status: 200,
      body: await this.mint(app, sub as string, grantableScopes(granted.scope)),
    };
  }

  /** The new pair is minted under the app's current switch, so turning it off moves the app to keys that never expire on its next refresh. The old key goes only once the new pair exists. */
  private async refreshGrant(
    app: OauthApp,
    body: { client_secret?: unknown; refresh_token: string },
  ): Promise<OAuthReply> {
    if (
      typeof body.client_secret !== 'string' ||
      !(await this.authenticates(app, body.client_secret))
    )
      return oauthError(200, 'incorrect_client_credentials');
    const refreshToken = body.refresh_token;
    const token = await this.db.transaction(async (tx) => {
      const grant = await spendRefreshToken(tx, app.clientId, refreshToken);
      if (!grant) return null;
      const minted = await this.mint(app, grant.userId, grant.scopes, tx);
      await (app.ghostAppId
        ? tx
            .delete(schema.appUserToken)
            .where(eq(schema.appUserToken.id, grant.accessKeyId))
        : tx
            .delete(schema.apikey)
            .where(eq(schema.apikey.id, grant.accessKeyId)));
      return minted;
    });
    if (!token) return oauthError(200, 'bad_refresh_token');
    return { status: 200, body: token };
  }

  /** The plugin checks a secret its own way; introspecting a token it does not hold fails only on bad credentials. */
  private async authenticates(app: OauthApp, clientSecret: string) {
    if (app.ghostAppId)
      return Boolean(
        await this.appClients.authenticate(app.clientId, clientSecret),
      );
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

  /** One token response for every grant, so the device flow, the code exchange and a refresh answer alike. */
  private async mint(
    app: OauthApp,
    userId: string,
    scopes: string[],
    executor: Executor = this.db,
  ) {
    if (app.ghostAppId)
      return this.mintForApp(app, app.ghostAppId, userId, executor);
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

  /** GitHub's user-to-server reply: a `ghu_` token with no scopes, and a `ghr_` refresh token when the app's tokens expire. */
  private async mintForApp(
    app: OauthApp,
    appId: string,
    userId: string,
    executor: Executor,
  ) {
    const minted = await this.userTokens.mint(executor, {
      appId,
      userId,
      expires: app.expireUserTokens,
    });
    const token = {
      access_token: minted.token,
      token_type: 'bearer',
      scope: '',
    };
    if (!app.expireUserTokens) return token;
    return {
      ...token,
      expires_in: ACCESS_TOKEN_EXPIRES_IN,
      refresh_token: await issueRefreshToken(
        executor,
        app.clientId,
        { userId, scopes: [], accessKeyId: minted.id },
        generateUserRefreshToken(),
      ),
      refresh_token_expires_in: REFRESH_TOKEN_EXPIRES_IN,
    };
  }
}
