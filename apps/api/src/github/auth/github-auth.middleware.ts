import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { NextFunction, Response } from 'express';

import { verifyApiKey } from '../../lib/api-keys/verify-api-key.js';
import { type Auth, AUTHORIZATION_TOKEN } from '../../lib/auth.js';
import { KNOWN_SCOPES, scopesOfKey } from '../../lib/github/scopes.js';
import { rateLimitHeaders } from '../../lib/rate-limit/headers.js';
import {
  GITHUB_RATE_LIMIT_DOCUMENTATION_URL,
  RateLimitedError,
} from '../../lib/rate-limit/rate-limit.errors.js';
import { RateLimitGuard } from '../../rate-limit/rate-limit.guard.js';
import type { GithubRequest, GithubViewer } from './github-request.js';

const GITHUB_MEDIA_TYPE = /application\/vnd\.github\b/i;
/** `gh pr diff` asks for the raw diff or patch, which is not JSON and which the pulls controller answers by this header. */
const RAW_MEDIA_TYPE = /application\/vnd\.github(?:\.v3)?\.(?:diff|patch)\b/i;
const GRAPHQL_PATH = /^\/api\/graphql(?:[/?]|$)/;

/** Resolves `Authorization: token|Bearer <key>` (what gh sends) or a session cookie (GraphiQL in a browser) to a viewer, and sets the headers gh reads on every compat response. */
@Injectable()
export class GithubAuthMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService<Auth>,
    private readonly rateLimit: RateLimitGuard,
  ) {}

  async use(req: GithubRequest, res: Response, next: NextFunction) {
    res.setHeader('X-GitHub-Media-Type', 'github.v3; format=json');
    // gh asks for GitHub's preview media types, which Apollo answers 406 because they do not name JSON; they are JSON.
    const accept = req.headers.accept ?? '';
    if (GITHUB_MEDIA_TYPE.test(accept) && !RAW_MEDIA_TYPE.test(accept))
      req.headers.accept = 'application/json';
    const header = req.headers.authorization;
    const token = header ? AUTHORIZATION_TOKEN.exec(header)?.[1] : undefined;

    if (header && !token) return this.badCredentials(res);
    const viewer = token
      ? await this.fromKey(token)
      : await this.fromSession(req);
    if (token && !viewer) return this.badCredentials(res);

    req.githubViewer = viewer;
    res.setHeader('X-OAuth-Scopes', viewer ? viewer.scopes.join(', ') : '');
    // GraphQL never reaches RateLimitGuard as HTTP, so it is counted here, before Apollo, once whatever the query; REST is counted by the guard.
    if (GRAPHQL_PATH.test(req.originalUrl)) {
      const decision = (await this.rateLimit.count(req))[0]!;
      if (!decision.allowed) {
        const refused = new RateLimitedError(decision);
        res.set(refused.headers).status(refused.status).json({
          message: refused.message,
          documentation_url: GITHUB_RATE_LIMIT_DOCUMENTATION_URL,
        });
        return;
      }
      res.set(rateLimitHeaders(decision));
    }
    next();
  }

  private async fromKey(key: string): Promise<GithubViewer | null> {
    const apiKey = await verifyApiKey(this.auth.api, key);
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
      documentation_url: 'https://docs.github.com/rest',
    });
  }
}
