import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { clientIp } from '../lib/http/client-ip.js';
import { type Budgets, rateLimitBudgets } from '../lib/rate-limit/budgets.js';
import { rateLimitHeaders, tightest } from '../lib/rate-limit/headers.js';
import {
  RateLimitedError,
  RateLimiterUnavailableError,
} from '../lib/rate-limit/rate-limit.errors.js';
import { RateLimiterService } from '../services/rate-limit/rate-limiter.service.js';

const AUTH_BASE_PATH = '/api/auth';
/** Every Better Auth path that checks a credential. */
const SIGN_IN_PATHS = new Set([
  '/sign-in/email',
  '/sign-in/username',
  '/two-factor/verify-totp',
  '/two-factor/verify-otp',
  '/two-factor/verify-backup-code',
  '/passkey/verify-authentication',
]);
/** Every Better Auth path that creates an account or sends mail to an address the caller names. */
const SIGN_UP_PATHS = new Set([
  '/sign-up/email',
  '/request-password-reset',
  '/forget-password',
  '/reset-password',
  '/send-verification-email',
]);

/** Counts sign-in, sign-up and reset per client address ahead of Better Auth's handler, and failed sign-ins against a tighter budget. */
@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthRateLimitMiddleware.name);
  private readonly budgets: Budgets;

  constructor(
    private readonly limiter: RateLimiterService,
    config: ConfigService,
  ) {
    this.budgets = rateLimitBudgets(config);
  }

  async use(req: Request, res: Response, next: () => void) {
    const path = req.path.slice(AUTH_BASE_PATH.length);
    const signIn = SIGN_IN_PATHS.has(path);
    if (!signIn && !SIGN_UP_PATHS.has(path)) return next();
    const ip = clientIp(req);
    try {
      const decisions = signIn
        ? [await this.limiter.peek(this.budgets.failedSignIn, ip)]
        : [];
      if (decisions[0]?.allowed !== false)
        decisions.push(
          await this.limiter.consume(
            signIn ? this.budgets.signIn : this.budgets.signUp,
            ip,
          ),
        );
      const shown = tightest(decisions);
      if (!shown.allowed) {
        const refused = new RateLimitedError(shown);
        res
          .set(refused.headers)
          .status(refused.status)
          .json({ message: refused.message });
        return;
      }
      res.set(rateLimitHeaders(shown));
    } catch (error) {
      // Better Auth's `next` takes no error, so this answers for it.
      if (!(error instanceof RateLimiterUnavailableError)) throw error;
      res.status(error.status).json({ message: error.message });
      return;
    }

    if (signIn) {
      const end = res.end.bind(res) as (...args: unknown[]) => Response;
      res.end = ((...args: unknown[]) => {
        const failed =
          res.statusCode >= 400 &&
          res.statusCode < 500 &&
          res.statusCode !== 429;
        if (!failed) return end(...args);
        // Counted before the response leaves, so the client's next attempt already finds it.
        void this.limiter
          .consume(this.budgets.failedSignIn, ip)
          .catch((error: unknown) => this.logger.error(error))
          .finally(() => end(...args));
        return res;
      }) as Response['end'];
    }
    next();
  }
}
