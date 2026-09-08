import { Injectable, NestMiddleware } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import type { NextFunction, Request, Response } from 'express';

import type { Auth } from '../../../lib/auth.js';
import { RepositoryNotFoundError } from '../../../resources/repositories/repositories.errors.js';
import { AuthenticationRequiredError } from '../../../services/git/repository-access/repository-access.errors.js';
import {
  RepositoryAccessService,
  type Actor,
} from '../../../services/git/repository-access/repository-access.service.js';
import { GitAuthenticatedBufferedRequest } from '../../types.js';

/** Runs before the body is spooled, so a rejected push never reaches disk. */
@Injectable()
export class GitBasicAuthMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService<Auth>,
    private readonly access: RepositoryAccessService,
  ) {}

  async use(
    req: GitAuthenticatedBufferedRequest,
    res: Response,
    next: NextFunction,
  ) {
    const { username, repo } = req.params as Record<string, string>;
    if (!username || !repo) return next(new RepositoryNotFoundError());

    // Git asks for the receive-pack advertisement before it pushes, so a
    // read-only actor is turned away at `info/refs` rather than a round trip later.
    const isPush =
      req.path.endsWith('/git-receive-pack') ||
      req.query.service === 'git-receive-pack';

    try {
      const actor = await this.resolveActor(req);
      req.repository = await this.access.authorize({
        username,
        repo: repo.replace(/\.git$/, ''),
        actor,
        operation: isPush ? 'write' : 'read',
      });

      req.actor = actor;
      next();
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) return next(error);
      // Git only sends credentials once challenged, so this is not a dead end.
      res.setHeader('WWW-Authenticate', 'Basic realm="Ghost"');
      res.status(401).end();
    }
  }

  private async resolveActor(req: Request): Promise<Actor> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Basic ')) return null;

    // Username is ignored; the password is the API key, and may contain ":".
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const key = decoded.slice(decoded.indexOf(':') + 1);
    if (!key) return null;

    const { valid, key: apiKey } = await this.auth.api.verifyApiKey({
      body: { key },
    });

    // A bad key is treated as no key, so the caller is challenged again.
    return valid && apiKey ? { userId: apiKey.referenceId } : null;
  }
}
