import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '@thallesp/nestjs-better-auth';
import type { NextFunction, Request, Response } from 'express';

import type { Auth } from '../../../lib/auth.js';
import { RepositoryNotFoundError } from '../../../resources/repositories/repositories.errors.js';
import { AuthenticationRequiredError } from '../../../lib/git/repository-access/repository-access.errors.js';
import { RepositoryAccessService } from '../../../services/git/repository-access/repository-access.service.js';
import { type Actor } from '../../../lib/git/repository-access/repository-access.js';
import {
  type LfsTokenClaims,
  verifyLfsToken,
} from '../../../lib/git/lfs/lfs-token.js';
import { GitAuthenticatedBufferedRequest } from '../../types.js';

/** Runs before the body is spooled, so a rejected push never reaches disk. */
@Injectable()
export class GitBasicAuthMiddleware implements NestMiddleware {
  private readonly secret: string;

  constructor(
    private readonly auth: AuthService<Auth>,
    private readonly access: RepositoryAccessService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('BETTER_AUTH_SECRET');
  }

  async use(
    req: GitAuthenticatedBufferedRequest,
    res: Response,
    next: NextFunction,
  ) {
    const { username, repo } = req.params as Record<string, string>;
    if (!username || !repo) return next(new RepositoryNotFoundError());

    const isLfs = req.path.includes('/info/lfs/');
    // Git asks for the receive-pack advertisement before it pushes, so a read-only actor is turned away at `info/refs` rather than a round trip later. LFS names its operation in the batch body, which is parsed before this runs, uploads with PUT, and changes locks with POST.
    const isPush =
      req.path.endsWith('/git-receive-pack') ||
      req.query.service === 'git-receive-pack' ||
      req.method === 'PUT' ||
      (req.method === 'POST' && req.path.includes('/info/lfs/locks')) ||
      (req.body as { operation?: unknown } | undefined)?.operation === 'upload';

    try {
      const { actor, apiKeyId, scope } = await this.resolveKey(req);
      req.repository = await this.access.authorize({
        username,
        repo: repo.replace(/\.git$/, ''),
        requesterId: actor?.userId,
        operation: isPush ? 'write' : 'read',
      });
      // A token from `git-lfs-authenticate` is good for the LFS API of one repository, and for writes only if it was asked for an upload.
      if (
        scope &&
        (!isLfs ||
          scope.repositoryId !== req.repository.id ||
          (isPush && scope.operation !== 'upload'))
      ) {
        throw new AuthenticationRequiredError();
      }

      req.actor = actor;
      req.apiKeyId = apiKeyId;
      next();
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) return next(error);
      // Git only sends credentials once challenged, so this is not a dead end.
      res.setHeader('WWW-Authenticate', 'Basic realm="Ghost"');
      res.status(401).end();
    }
  }

  private async resolveKey(req: Request): Promise<{
    actor: Actor;
    apiKeyId: string | null;
    scope?: LfsTokenClaims;
  }> {
    const anonymous = { actor: null, apiKeyId: null };
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const scope = verifyLfsToken(this.secret, header.slice(7));
      return scope
        ? { actor: { userId: scope.userId }, apiKeyId: null, scope }
        : anonymous;
    }
    if (!header?.startsWith('Basic ')) return anonymous;

    // Username is ignored; the password is the API key, and may contain ":".
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const key = decoded.slice(decoded.indexOf(':') + 1);
    if (!key) return anonymous;

    const { valid, key: apiKey } = await this.auth.api.verifyApiKey({
      body: { key },
    });

    // A bad key is treated as no key, so the caller is challenged again.
    return valid && apiKey
      ? { actor: { userId: apiKey.referenceId }, apiKeyId: apiKey.id }
      : anonymous;
  }
}
