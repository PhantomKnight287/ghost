import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { Budget } from '../../lib/rate-limit/budgets.js';
import type { RateLimitDecision } from '../../lib/rate-limit/headers.js';
import { RateLimiterUnavailableError } from '../../lib/rate-limit/rate-limit.errors.js';
import { REDIS } from '../../lib/rate-limit/redis.js';

// KEYS are the counters; ARGV[1] the window, ARGV[2] whether to count, then one limit per key. Nothing is counted unless every counter has room.
const CONSUME = `
local window = tonumber(ARGV[1])
local used, room = {}, true
for i, key in ipairs(KEYS) do
  used[i] = tonumber(redis.call('GET', key) or '0')
  if used[i] >= tonumber(ARGV[i + 2]) then room = false end
end
local reply = {}
for i, key in ipairs(KEYS) do
  local allowed = used[i] < tonumber(ARGV[i + 2])
  if room and ARGV[2] == '1' then
    used[i] = redis.call('INCR', key)
    if used[i] == 1 then redis.call('PEXPIRE', key, window) end
  end
  local ttl = redis.call('PTTL', key)
  if ttl < 0 then ttl = window end
  table.insert(reply, used[i])
  table.insert(reply, ttl)
  table.insert(reply, allowed and 1 or 0)
end
return reply
`;

/** Fixed windows in Redis, one counter per budget and caller, counted and expired in one atomic script. */
@Injectable()
export class RateLimiterService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Optional() private readonly windowMs: number = 60_000,
  ) {}

  async consume(budget: Budget, key: string): Promise<RateLimitDecision> {
    return (await this.run(key, [budget], true))[0]!;
  }

  async peek(budget: Budget, key: string): Promise<RateLimitDecision> {
    return (await this.run(key, [budget], false))[0]!;
  }

  /** One decision per budget, in order; every budget is charged, or none when any is spent. */
  consumeTogether(
    key: string,
    budgets: Budget[],
  ): Promise<RateLimitDecision[]> {
    return this.run(key, budgets, true);
  }

  private async run(
    key: string,
    budgets: Budget[],
    count: boolean,
  ): Promise<RateLimitDecision[]> {
    let reply: number[];
    try {
      reply = (await this.redis.eval(
        CONSUME,
        budgets.length,
        ...budgets.map((budget) => `ratelimit:${budget.name}:${key}`),
        this.windowMs,
        count ? '1' : '0',
        ...budgets.map((budget) => budget.limit),
      )) as number[];
    } catch {
      throw new RateLimiterUnavailableError();
    }
    return budgets.map((budget, i) => {
      const [used, ttl, allowed] = reply.slice(i * 3, i * 3 + 3) as [
        number,
        number,
        number,
      ];
      return {
        budget,
        used,
        remaining: Math.max(0, budget.limit - used),
        resetAt: Math.ceil((Date.now() + ttl) / 1000),
        retryAfter: Math.max(1, Math.ceil(ttl / 1000)),
        allowed: allowed === 1,
      };
    });
  }
}
