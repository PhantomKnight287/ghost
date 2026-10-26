import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { type Budgets, rateLimitBudgets } from '../lib/rate-limit/budgets.js';
import {
  type RateLimitDecision,
  rateLimitHeaders,
  tightest,
} from '../lib/rate-limit/headers.js';
import { RateLimitedError } from '../lib/rate-limit/rate-limit.errors.js';
import { rateLimitIdentity } from '../lib/rate-limit/request-identity.js';
import { RateLimiterService } from '../services/rate-limit/rate-limiter.service.js';

const EXPENSIVE_READ = 'EXPENSIVE_READ';
const NOT_RATE_LIMITED = 'NOT_RATE_LIMITED';

/** Also draws from the smaller `search` budget; `when` narrows it to the requests that are expensive, such as a diff asked for by media type. */
export const ExpensiveRead = (
  when: (request: Request) => boolean = () => true,
) => SetMetadata(EXPENSIVE_READ, when);

/** Health checks and internal callbacks, which no user's budget should pay for. */
export const NotRateLimited = () => SetMetadata(NOT_RATE_LIMITED, true);

export type RateLimitedRequest = Request & {
  user?: { id: string } | null;
  githubViewer?: { userId: string } | null;
  /** The main budget's decision, so a request is counted once however many guards or resolvers it passes. */
  rateLimit?: RateLimitDecision;
};

/** Counts every HTTP request against its caller's main budget, and expensive reads against `search` too, then reports the tighter one in GitHub's headers. GraphQL is counted by GithubAuthMiddleware, before Apollo. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly budgets: Budgets;
  private readonly webSecret: string | undefined;

  constructor(
    private readonly limiter: RateLimiterService,
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.budgets = rateLimitBudgets(config);
    this.webSecret = config.get<string>('WEB_API_SECRET');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(NOT_RATE_LIMITED, targets))
      return true;
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const decisions = [await this.count(request)];
    const expensive = this.reflector.getAllAndOverride<
      ((request: Request) => boolean) | undefined
    >(EXPENSIVE_READ, targets);
    if (decisions[0].allowed && expensive?.(request))
      decisions.push(
        await this.limiter.consume(
          this.budgets.search,
          rateLimitIdentity(request, this.webSecret).key,
        ),
      );
    const shown = tightest(decisions);
    context.switchToHttp().getResponse<Response>().set(rateLimitHeaders(shown));
    if (!shown.allowed) throw new RateLimitedError(shown);
    return true;
  }

  /** The request's main-budget decision, counted on the first call only. */
  async count(request: RateLimitedRequest): Promise<RateLimitDecision> {
    if (request.rateLimit) return request.rateLimit;
    const { signedIn, key, web } = rateLimitIdentity(request, this.webSecret);
    const budget = web
      ? signedIn
        ? this.budgets.web
        : this.budgets.webAnonymous
      : signedIn
        ? this.budgets.core
        : this.budgets.coreAnonymous;
    request.rateLimit = await this.limiter.consume(budget, key);
    return request.rateLimit;
  }
}
