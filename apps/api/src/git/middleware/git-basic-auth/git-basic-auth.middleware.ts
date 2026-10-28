import type { Database } from '@ghost/db';
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '@thallesp/nestjs-better-auth';
import type { NextFunction, Request, Response } from 'express';

import { DATABASE } from '../../../database/database.module.js';
import { verifyApiKey } from '../../../lib/api-keys/verify-api-key.js';
import type { Auth } from '../../../lib/auth.js';
import {
  type LfsTokenClaims,
  verifyLfsToken,
} from '../../../lib/git/lfs/lfs-token.js';
import { hasScope, scopesOfKey } from '../../../lib/github/scopes.js';
import { clientIp } from '../../../lib/http/client-ip.js';
import {
  type Budget,
  rateLimitBudgets,
} from '../../../lib/rate-limit/budgets.js';
import { rateLimitHeaders } from '../../../lib/rate-limit/headers.js';
import { oauthAppBlocked } from '../../../lib/organizations/oauth-app-access.js';
import {
  AuthenticationRequiredError,
  RepositoryForbiddenError,
} from '../../../lib/repositories/access/repository-access.errors.js';
import { type Actor } from '../../../lib/repositories/access/repository-access.js';
import { RepositoryNotFoundError } from '../../../lib/repositories/repositories.errors.js';
import { RateLimiterService } from '../../../services/rate-limit/rate-limiter.service.js';
import { RepositoryAccessService } from '../../../services/git/repository-access/repository-access.service.js';
import { GitAuthenticatedBufferedRequest } from '../../types.js';

/** LFS object transfers, which the batch call already bounds; the batch call itself counts. */
const LFS_TRANSFER = /\/info\/lfs\/objects\/(?!batch$)[^/]+$/;

/** Runs before the body is spooled, so a rejected push never reaches disk. */
@Injectable()
export class GitBasicAuthMiddleware implements NestMiddleware {
  private readonly secret: string;
  private readonly budget: Budget;

  constructor(
    private readonly auth: AuthService<Auth>,
    private readonly access: RepositoryAccessService,
    private readonly limiter: RateLimiterService,
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('BETTER_AUTH_SECRET');
    this.budget = rateLimitBudgets(config).git;
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
      const { actor, apiKeyId, scope, scopes, oauthClientId } =
        await this.resolveKey(req);
      if (!LFS_TRANSFER.test(req.path)) {
        const decision = await this.limiter.consume(
          this.budget,
          actor?.userId ?? clientIp(req),
        );
        res.set(rateLimitHeaders(decision));
        // Plain text without `WWW-Authenticate`, so git prints the reason instead of asking for a password.
        if (!decision.allowed) {
          res
            .status(429)
            .type('text/plain')
            .send(
              `API rate limit exceeded; try again in ${decision.retryAfter} seconds\n`,
            );
          return;
        }
      }
      req.repository = await this.access.authorize({
        username,
        repo: repo.replace(/\.git$/i, ''),
        requesterId: actor?.userId,
        operation: isPush ? 'write' : 'read',
      });
      // A scoped token reads private repositories only with `repo`, and pushes with `repo` or, to a public repository, `public_repo`. Unreadable reads as missing, as on GitHub.
      if (scopes) {
        const isPrivate = req.repository.visibility === 'private';
        if (isPrivate && !hasScope(scopes, 'repo'))
          throw new RepositoryNotFoundError();
        if (isPush && !hasScope(scopes, isPrivate ? 'repo' : 'public_repo'))
          throw new RepositoryForbiddenError();
      }
      // An OAuth app the organization has not approved cannot see its repositories at all.
      if (
        oauthClientId &&
        req.repository.organizationId &&
        (await oauthAppBlocked(this.db, {
          clientId: oauthClientId,
          organizationId: req.repository.organizationId,
        }))
      )
        throw new RepositoryNotFoundError();
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
    scopes: readonly string[] | null;
    oauthClientId?: string;
  }> {
    const anonymous = { actor: null, apiKeyId: null, scopes: null };
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const scope = verifyLfsToken(this.secret, header.slice(7));
      return scope
        ? {
            actor: { userId: scope.userId },
            apiKeyId: null,
            scope,
            scopes: null,
          }
        : anonymous;
    }
    if (!header?.startsWith('Basic ')) return anonymous;

    // Username is ignored; the password is the API key, and may contain ":".
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const key = decoded.slice(decoded.indexOf(':') + 1);
    if (!key) return anonymous;

    const apiKey = await verifyApiKey(this.auth.instance, key);

    // A bad key is treated as no key, so the caller is challenged again.
    return apiKey
      ? {
          actor: { userId: apiKey.referenceId },
          apiKeyId: apiKey.id,
          scopes: scopesOfKey(apiKey.permissions),
          oauthClientId: (apiKey.metadata as { oauthClientId?: string } | null)
            ?.oauthClientId,
        }
      : anonymous;
  }
}
