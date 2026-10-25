import {
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';

import type { Auth } from '../lib/auth.js';

const TOKEN = /^(?:token|bearer)\s+(\S+)$/i;
const COOKIE_ONLY = 'COOKIE_ONLY';

/** Routes that could take the account over or hand out its access (addresses, OAuth apps) refuse personal access tokens and want the browser session. */
export const CookieOnly = () => SetMetadata(COOKIE_ONLY, true);

/**
 * The global guard: `Authorization: token|Bearer <key>` signs the request in as the key's owner; without one, the session cookie decides as before.
 * Public and optional routes (git, LFS, GitHub's paths) authenticate themselves, so a token there is left to them.
 * Keys that carry scopes are OAuth app tokens, which reach only GitHub's paths until native routes check scopes.
 */
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
    const key = TOKEN.exec(request.headers.authorization ?? '')?.[1];
    if (
      !key ||
      this.marked(context, 'PUBLIC') ||
      this.marked(context, 'OPTIONAL')
    )
      return super.canActivate(context);

    const { valid, key: apiKey } = await this.options_.auth.api.verifyApiKey({
      body: { key },
    });
    if (!valid || !apiKey) throw new UnauthorizedException('Bad credentials');
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
