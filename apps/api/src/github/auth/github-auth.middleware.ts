import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { NextFunction, Response } from 'express';

import { type Auth, AUTHORIZATION_TOKEN } from '../../lib/auth.js';
import { KNOWN_SCOPES, scopesOfKey } from '../../lib/github/scopes.js';
import type { GithubRequest, GithubViewer } from './github-request.js';

const GITHUB_MEDIA_TYPE = /application\/vnd\.github\b/i;
/** `gh pr diff` asks for the raw diff or patch, which is not JSON and which the pulls controller answers by this header. */
const RAW_MEDIA_TYPE = /application\/vnd\.github(?:\.v3)?\.(?:diff|patch)\b/i;

/** Resolves `Authorization: token|Bearer <key>` (what gh sends) or a session cookie (GraphiQL in a browser) to a viewer, and sets the headers gh reads on every compat response. */
@Injectable()
export class GithubAuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService<Auth>) {}

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
    next();
  }

  private async fromKey(key: string): Promise<GithubViewer | null> {
    const { valid, key: apiKey } = await this.auth.api.verifyApiKey({
      body: { key },
    });
    return valid && apiKey
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
