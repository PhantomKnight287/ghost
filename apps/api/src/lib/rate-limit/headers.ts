import type { Budget } from './budgets.js';

export type RateLimitDecision = {
  budget: Budget;
  used: number;
  remaining: number;
  /** Epoch seconds. */
  resetAt: number;
  /** Whole seconds, at least 1. */
  retryAfter: number;
  allowed: boolean;
};

/** GitHub's rate-limit headers for one decision; `Retry-After` only on a refusal. */
export function rateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(decision.budget.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
    'X-RateLimit-Used': String(decision.used),
    'X-RateLimit-Reset': String(decision.resetAt),
    'X-RateLimit-Resource': decision.budget.resource,
    ...(!decision.allowed && { 'Retry-After': String(decision.retryAfter) }),
  };
}

/** The decision the headers show when a request draws from several budgets: a refusal, else the one with fewest requests left. */
export function tightest(decisions: RateLimitDecision[]): RateLimitDecision {
  return decisions.reduce((tight, decision) => {
    if (!tight.allowed) return tight;
    if (!decision.allowed || decision.remaining < tight.remaining)
      return decision;
    return tight;
  });
}
