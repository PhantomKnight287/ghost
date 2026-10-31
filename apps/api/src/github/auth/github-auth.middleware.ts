import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { NextFunction, Response } from 'express';

import { verifyApiKey } from '../../lib/api-keys/verify-api-key.js';
import { APP_JWT } from '../../lib/apps/app-jwt.js';
import { AppJwtError, JWT_UNDECODABLE } from '../../lib/apps/apps.errors.js';
import { installationCaller } from '../../lib/apps/installation-context.js';
import { INSTALLATION_TOKEN } from '../../lib/apps/installation-token.js';
import { USER_TOKEN } from '../../lib/apps/user-token.js';
import { userToServerCaller } from '../../lib/apps/user-token-context.js';
import { AUTHORIZATION_TOKEN, type Auth } from '../../lib/auth.js';
import { KNOWN_SCOPES, scopesOfKey } from '../../lib/github/scopes.js';
import { rateLimitHeaders } from '../../lib/rate-limit/headers.js';
import {
  GITHUB_RATE_LIMIT_DOCUMENTATION_URL,
  RateLimitedError,
} from '../../lib/rate-limit/rate-limit.errors.js';
import { RateLimitGuard } from '../../rate-limit/rate-limit.guard.js';
import { AppJwtService } from '../../services/apps/app-jwt.service.js';
import { InstallationTokensService } from '../../services/apps/installation-tokens.service.js';
import { UserTokensService } from '../../services/apps/user-tokens.service.js';
import type { GithubRequest, GithubViewer } from './github-request.js';

const GITHUB_MEDIA_TYPE = /application\/vnd\.github\b/i;
/** `gh pr diff` asks for the raw diff or patch, which is not JSON and which the pulls controller answers by this header. */
const RAW_MEDIA_TYPE = /application\/vnd\.github(?:\.v3)?\.(?:diff|patch)\b/i;
const GRAPHQL_PATH = /^\/api\/graphql(?:[/?]|$)/;
/** An app's own client id and secret over HTTP Basic: the routes check them, with no viewer. */
const APPLICATIONS_PATH = /^\/api\/v3\/applications\//;
const DOCUMENTATION_URL = 'https://docs.github.com/rest';
const END = String.raw`\/?(?:\?|$)`;
const SEGMENT = '[^/?]+';
/** The only routes an app JWT may call; anything else is refused before it can be read as an anonymous request. */
const APP_JWT_ROUTES = [
  { method: 'GET', path: new RegExp(`^/api/v3/app${END}`) },
  { method: 'GET', path: new RegExp(`^/api/v3/app/installations${END}`) },
  {
    method: 'GET',
    path: new RegExp(`^/api/v3/app/installations/\\d+${END}`),
  },
  {
    method: 'DELETE',
    path: new RegExp(`^/api/v3/app/installations/\\d+${END}`),
  },
  {
    method: 'POST',
    path: new RegExp(`^/api/v3/app/installations/\\d+/access_tokens${END}`),
  },
  {
    method: 'GET',
    path: new RegExp(`^/api/v3/repos/${SEGMENT}/${SEGMENT}/installation${END}`),
  },
  {
    method: 'GET',
    path: new RegExp(`^/api/v3/(?:orgs|users)/${SEGMENT}/installation${END}`),
  },
];

/** Resolves `Authorization: token|Bearer <key>` (what gh sends) or a session cookie (GraphiQL in a browser) to a viewer, and sets the headers gh reads on every compat response. */
@Injectable()
export class GithubAuthMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService<Auth>,
    private readonly rateLimit: RateLimitGuard,
    private readonly appJwt: AppJwtService,
    private readonly installationTokens: InstallationTokensService,
    private readonly userTokens: UserTokensService,
  ) {}

  async use(req: GithubRequest, res: Response, next: NextFunction) {
    res.setHeader('X-GitHub-Media-Type', 'github.v3; format=json');
    // gh asks for GitHub's preview media types, which Apollo answers 406 because they do not name JSON; they are JSON.
    const accept = req.headers.accept ?? '';
    if (GITHUB_MEDIA_TYPE.test(accept) && !RAW_MEDIA_TYPE.test(accept))
      req.headers.accept = 'application/json';
    const header = req.headers.authorization;
    const token = header ? AUTHORIZATION_TOKEN.exec(header)?.[1] : undefined;

    if (header && !token && !APPLICATIONS_PATH.test(req.originalUrl))
      return this.badCredentials(res);
    req.githubApp = null;
    req.appInstallation = null;
    req.userToServer = null;
    if (token && INSTALLATION_TOKEN.test(token))
      return this.asInstallation(req, res, next, token);
    if (token && USER_TOKEN.test(token))
      return this.asUserThroughApp(req, res, next, token);
    if (token && APP_JWT.test(token)) return this.asApp(req, res, next, token);
    const viewer = token
      ? await this.fromKey(token)
      : await this.fromSession(req);
    if (token && !viewer) return this.badCredentials(res);

    req.githubViewer = viewer;
    res.setHeader('X-OAuth-Scopes', viewer ? viewer.scopes.join(', ') : '');
    if (await this.countGraphql(req, res)) next();
  }

  /** GraphQL never reaches RateLimitGuard as HTTP, so it is counted here, before Apollo, once whatever the query; REST is counted by the guard. False when the request was refused. */
  private async countGraphql(req: GithubRequest, res: Response) {
    if (!GRAPHQL_PATH.test(req.originalUrl)) return true;
    const decision = (await this.rateLimit.count(req))[0]!;
    if (!decision.allowed) {
      const refused = new RateLimitedError(decision);
      res.set(refused.headers).status(refused.status).json({
        message: refused.message,
        documentation_url: GITHUB_RATE_LIMIT_DOCUMENTATION_URL,
      });
      return false;
    }
    res.set(rateLimitHeaders(decision));
    return true;
  }

  // ponytail: every installation of an app shares its bot's budget; GitHub counts each installation on its own.
  private async asInstallation(
    req: GithubRequest,
    res: Response,
    next: NextFunction,
    token: string,
  ) {
    const installation = await this.installationTokens.verify(token);
    if (!installation) return this.badCredentials(res);
    // The app routes take only a JWT, and GitHub answers anything else there as an undecodable one.
    if (this.isAppRoute(req)) {
      res.status(401).json({
        message: JWT_UNDECODABLE,
        documentation_url: DOCUMENTATION_URL,
      });
      return;
    }
    req.appInstallation = installation;
    // `repo` lets the viewer reach private repositories at all; the installation's permissions and repositories narrow it per route.
    req.githubViewer = {
      userId: installation.botUserId,
      scopes: ['repo'],
      oauthClientId: null,
      installation,
    };
    res.setHeader('X-OAuth-Scopes', '');
    if (!(await this.countGraphql(req, res))) return;
    installationCaller.run(installation, next);
  }

  /** A `ghu_` token acts as its user. Scopes do not limit it: AppPermissionGuard holds it to what the app and the user may both do. */
  private async asUserThroughApp(
    req: GithubRequest,
    res: Response,
    next: NextFunction,
    token: string,
  ) {
    const caller = await this.userTokens.verify(token);
    if (!caller) return this.badCredentials(res);
    req.userToServer = caller;
    req.githubViewer = {
      userId: caller.userId,
      scopes: KNOWN_SCOPES,
      oauthClientId: null,
    };
    res.setHeader('X-OAuth-Scopes', '');
    if (GRAPHQL_PATH.test(req.originalUrl) || this.isAppRoute(req)) {
      res.status(403).json({
        message: 'Resource not accessible by integration',
        documentation_url: DOCUMENTATION_URL,
      });
      return;
    }
    userToServerCaller.run(caller, next);
  }

  // ponytail: an app counts against the anonymous budget of its address until installations give it its own.
  private async asApp(
    req: GithubRequest,
    res: Response,
    next: NextFunction,
    token: string,
  ) {
    try {
      req.githubApp = await this.appJwt.verify(token);
    } catch (error) {
      if (!(error instanceof AppJwtError)) throw error;
      res
        .status(error.status)
        .json({ message: error.message, documentation_url: DOCUMENTATION_URL });
      return;
    }
    req.githubViewer = null;
    res.setHeader('X-OAuth-Scopes', '');
    if (!this.isAppRoute(req)) {
      res.status(403).json({
        message: 'Resource not accessible by integration',
        documentation_url: DOCUMENTATION_URL,
      });
      return;
    }
    next();
  }

  private isAppRoute(req: GithubRequest) {
    return APP_JWT_ROUTES.some(
      ({ method, path }) => req.method === method && path.test(req.originalUrl),
    );
  }

  private async fromKey(key: string): Promise<GithubViewer | null> {
    const apiKey = await verifyApiKey(this.auth.instance, key);
    return apiKey
      ? {
          userId: apiKey.referenceId,
          scopes: scopesOfKey(apiKey.permissions),
          oauthClientId:
            (apiKey.metadata as { oauthClientId?: string } | null)
              ?.oauthClientId ?? null,
        }
      : null;
  }

  private async fromSession(req: GithubRequest): Promise<GithubViewer | null> {
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    return session
      ? { userId: session.user.id, scopes: KNOWN_SCOPES, oauthClientId: null }
      : null;
  }

  private badCredentials(res: Response) {
    res.status(401).json({
      message: 'Bad credentials',
      documentation_url: DOCUMENTATION_URL,
    });
  }
}
