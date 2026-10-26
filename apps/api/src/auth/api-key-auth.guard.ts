import {
  applyDecorators,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiSecurity } from '@nestjs/swagger';
import {
  AllowAnonymous,
  AuthGuard,
  OptionalAuth,
} from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';

import { verifyApiKey } from '../lib/api-keys/verify-api-key.js';
import { type Auth, AUTHORIZATION_TOKEN } from '../lib/auth.js';
import { clientIp } from '../lib/http/client-ip.js';
import { BAD_TOKEN_BUDGET } from '../lib/rate-limit/budgets.js';
import { RateLimitedError } from '../lib/rate-limit/rate-limit.errors.js';
import { RateLimiterService } from '../services/rate-limit/rate-limiter.service.js';

const COOKIE_ONLY = 'COOKIE_ONLY';

/** Routes that could take the account over or hand out its access (addresses, OAuth apps) refuse personal access tokens and want the browser session. */
export const CookieOnly = () => SetMetadata(COOKIE_ONLY, true);

/** Open to anyone, and the reference shows no sign-in. */
export const Anonymous = () =>
  applyDecorators(AllowAnonymous(), ApiSecurity({}));

/** Answers anyone, and more to someone signed in; the reference shows sign-in as optional. */
export const SignInOptional = () =>
  applyDecorators(
    OptionalAuth(),
    ApiSecurity({}),
    ApiSecurity('token'),
    ApiSecurity('session'),
  );

/** Signs a personal access token in as its owner on every route, public ones included, else defers to the session cookie; git, LFS and GitHub's paths authenticate tokens in their middleware, and scoped keys are OAuth app tokens, held to GitHub's paths until native routes check scopes. */
@Injectable()
export class ApiKeyAuthGuard extends AuthGuard {
  // Nest injects what AuthGuard's own @Inject metadata names: the Reflector and the auth module's options.
  constructor(
    private readonly metadata: Reflector,
    private readonly options_: { auth: Auth },
    private readonly limiter: RateLimiterService,
  ) {
    super(metadata, options_);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return super.canActivate(context);
    const request = context
      .switchToHttp()
      .getRequest<
        Request & { session?: unknown; user?: unknown; githubViewer?: unknown }
      >();
    const key = AUTHORIZATION_TOKEN.exec(
      request.headers.authorization ?? '',
    )?.[1];
    // Git and GitHub's paths authenticate in their own middleware, which LFS tokens and scoped keys rely on.
    if (!key || request.githubViewer !== undefined || 'actor' in request)
      return super.canActivate(context);

    const ip = clientIp(request);
    const throttled = await this.limiter.peek(BAD_TOKEN_BUDGET, ip);
    if (!throttled.allowed) throw new RateLimitedError(throttled);

    const apiKey = await verifyApiKey(this.options_.auth.api, key);
    if (!apiKey) {
      await this.limiter.consume(BAD_TOKEN_BUDGET, ip);
      throw new UnauthorizedException('Bad credentials');
    }
    if (apiKey.permissions?.scopes)
      throw new ForbiddenException(
        'OAuth app tokens reach only the GitHub-compatible API',
      );
    if (this.marked(context, COOKIE_ONLY))
      throw new ForbiddenException(
        'Personal access tokens cannot use this route; sign in instead',
      );

    const auth = await this.options_.auth.$context;
    const user = await auth.internalAdapter.findUserById(apiKey.referenceId);
    if (!user) throw new UnauthorizedException('Bad credentials');
    if (
      auth.options.emailAndPassword?.requireEmailVerification &&
      !user.emailVerified
    )
      throw new ForbiddenException('Verify your email address first');

    // No `token`: the raw key must never travel on as a session token.
    request.session = {
      user,
      session: {
        id: apiKey.id,
        userId: user.id,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
        apiKeyId: apiKey.id,
      },
    };
    request.user = user;
    return true;
  }

  private marked(context: ExecutionContext, flag: string) {
    return this.metadata.getAllAndOverride<boolean>(flag, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
