import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';
import { type RateLimitDecision, rateLimitHeaders } from './headers.js';

export const GITHUB_RATE_LIMIT_DOCUMENTATION_URL =
  'https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api';

export class RateLimitedError extends DomainError {
  readonly status = HttpStatus.TOO_MANY_REQUESTS;
  readonly headers: Record<string, string>;

  constructor(decision: RateLimitDecision) {
    super('API rate limit exceeded');
    this.headers = rateLimitHeaders(decision);
  }
}

export class RateLimiterUnavailableError extends DomainError {
  readonly status = HttpStatus.SERVICE_UNAVAILABLE;

  constructor() {
    super('Rate limiter unavailable; try again shortly');
  }
}
