import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

/** A good key past its budget; worded and headed as GitHub's primary rate limit, so clients wait instead of asking for a new token. */
export class ApiKeyRateLimitedError extends DomainError {
  readonly status = HttpStatus.TOO_MANY_REQUESTS;
  readonly headers: Record<string, string>;

  constructor(limit: number, tryAgainInMs: number) {
    super('API rate limit exceeded');
    const retryAfter = Math.max(1, Math.ceil(tryAgainInMs / 1000));
    this.headers = {
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Used': String(limit),
      'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + retryAfter),
      'X-RateLimit-Resource': 'core',
    };
  }
}
