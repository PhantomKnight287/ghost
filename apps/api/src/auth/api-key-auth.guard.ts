import {
  applyDecorators,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
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

import { type Auth, AUTHORIZATION_TOKEN } from '../lib/auth.js';

const COOKIE_ONLY = 'COOKIE_ONLY';
/** Bad tokens one address may send per window before it waits; `verifyApiKey` runs server-side, past Better Auth's own rate limiter. */
const FAILURE_LIMIT = 20;
const FAILURE_WINDOW_MS = 60_000;

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

/** Signs a personal access token in as its owner, else defers to the session cookie; public and optional routes (git, LFS, GitHub's paths) authenticate tokens themselves, and scoped keys are OAuth app tokens, held to GitHub's paths until native routes check scopes. */
@Injectable()
export class ApiKeyAuthGuard extends AuthGuard {
  // Nest injects what AuthGuard's own @Inject metadata names: the Reflector and the auth module's options.
  constructor(
    private readonly metadata: Reflector,
    private readonly options_: { auth: Auth },
  ) {
    super(metadata, options_);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return super.canActivate(context);
    const request = context
      .switchToHttp()
      .getRequest<Request & { session?: unknown; user?: unknown }>();
    const key = AUTHORIZATION_TOKEN.exec(
      request.headers.authorization ?? '',
    )?.[1];
    if (
      !key ||
      this.marked(context, 'PUBLIC') ||
      this.marked(context, 'OPTIONAL')
    )
      return super.canActivate(context);

    // Railway's proxy sets `X-Real-IP`, as `lib/auth.ts` trusts; elsewhere the header is the client's to forge.
    const realIp = request.headers['x-real-ip'];
    const ip =
      (process.env.RAILWAY_SERVICE_ID &&
        typeof realIp === 'string' &&
        realIp) ||
      request.ip ||
      'unknown';
    const failures = this.failures.get(ip);
    if (
      failures &&
      failures.resetAt > Date.now() &&
      failures.count >= FAILURE_LIMIT
    )
      throw new HttpException(
        'Too many bad credentials; try again in a minute',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const { valid, key: apiKey } = await this.options_.auth.api.verifyApiKey({
      body: { key },
    });
    if (!valid || !apiKey) {
      this.fail(ip);
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

  // ponytail: per-process counts; move to a shared store once the API runs more than one instance.
  private readonly failures = new Map<
    string,
    { count: number; resetAt: number }
  >();

  private nextSweepAt = 0;

  private fail(ip: string) {
    const now = Date.now();
    const entry = this.failures.get(ip);
    if (entry && entry.resetAt > now) entry.count++;
    else this.failures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
    // At most one sweep per window; only expired entries go, so no address loses its count.
    if (now >= this.nextSweepAt) {
      this.nextSweepAt = now + FAILURE_WINDOW_MS;
      for (const [stale, { resetAt }] of this.failures)
        if (resetAt <= now) this.failures.delete(stale);
    }
  }

  private marked(context: ExecutionContext, flag: string) {
    return this.metadata.getAllAndOverride<boolean>(flag, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
