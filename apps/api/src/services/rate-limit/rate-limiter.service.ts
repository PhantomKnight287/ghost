import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { Budget } from '../../lib/rate-limit/budgets.js';
import type { RateLimitDecision } from '../../lib/rate-limit/headers.js';
import { RateLimiterUnavailableError } from '../../lib/rate-limit/rate-limit.errors.js';

export const REDIS = Symbol('REDIS');

const CONSUME = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then return {used, redis.call('PTTL', KEYS[1]), 0} end
if ARGV[3] == '1' then
  used = redis.call('INCR', KEYS[1])
  if used == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[2]) end
return {used, ttl, 1}
`;

/** Fixed windows in Redis, one counter per budget and caller, counted and expired in one atomic script. */
@Injectable()
export class RateLimiterService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Optional() private readonly windowMs: number = 60_000,
  ) {}

  consume(budget: Budget, key: string): Promise<RateLimitDecision> {
    return this.run(budget, key, true);
  }

  peek(budget: Budget, key: string): Promise<RateLimitDecision> {
    return this.run(budget, key, false);
  }

  private async run(
    budget: Budget,
    key: string,
    count: boolean,
  ): Promise<RateLimitDecision> {
    let reply: [number, number, number];
    try {
      reply = (await this.redis.eval(
        CONSUME,
        1,
        `ratelimit:${budget.name}:${key}`,
        budget.limit,
        this.windowMs,
        count ? '1' : '0',
      )) as [number, number, number];
    } catch {
      throw new RateLimiterUnavailableError();
    }
    const [used, ttl, allowed] = reply;
    return {
      budget,
      used,
      remaining: Math.max(0, budget.limit - used),
      resetAt: Math.ceil((Date.now() + ttl) / 1000),
      retryAfter: Math.max(1, Math.ceil(ttl / 1000)),
      allowed: allowed === 1,
    };
  }
}
