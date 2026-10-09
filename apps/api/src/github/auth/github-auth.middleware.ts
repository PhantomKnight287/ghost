import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { NextFunction, Response } from 'express';

import type { Auth } from '../../lib/auth.js';
import { ALL_SCOPES } from '../../lib/github/scopes.js';
import type { GithubRequest, GithubViewer } from './github-request.js';

const TOKEN = /^(?:token|bearer)\s+(\S+)$/i;

/** Resolves `Authorization: token|Bearer <key>` (what gh sends) or a session cookie (GraphiQL in a browser) to a viewer, and sets the headers gh reads on every compat response. */
@Injectable()
export class GithubAuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService<Auth>) {}

  async use(req: GithubRequest, res: Response, next: NextFunction) {
    res.setHeader('X-GitHub-Media-Type', 'github.v3; format=json');
    const header = req.headers.authorization;
    const token = header ? TOKEN.exec(header)?.[1] : undefined;

    if (header && !token) return this.badCredentials(res);
    const viewer = token ? await this.fromKey(token) : await this.fromSession(req);
    if (token && !viewer) return this.badCredentials(res);

    req.githubViewer = viewer;
    res.setHeader('X-OAuth-Scopes', viewer ? viewer.scopes.join(', ') : '');
    next();
  }

  private async fromKey(key: string): Promise<GithubViewer | null> {
    const { valid, key: apiKey } = await this.auth.api.verifyApiKey({ body: { key } });
    return valid && apiKey ? { userId: apiKey.referenceId, scopes: ALL_SCOPES } : null;
  }

  private async fromSession(req: GithubRequest): Promise<GithubViewer | null> {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    return session ? { userId: session.user.id, scopes: ALL_SCOPES } : null;
  }

  private badCredentials(res: Response) {
    res.status(401).json({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
  }
}
