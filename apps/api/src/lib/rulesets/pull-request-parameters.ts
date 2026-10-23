import type { z } from 'zod';

import {
  type PullRequestRuleParameters,
  PullRequestRuleParametersZodSchema,
} from './rulesets.types.js';

/** Defaults filled in GitHub's way; an invalid body gives the first problem, naming its field. Left out entirely, the parameters are all defaults. */
export function parseRuleParameters<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; value: T } | { ok: false; message: string } {
  const result = schema.safeParse(input ?? {});
  if (input === null || !result.success) {
    const issue = result.error?.issues[0];
    if (!issue) return { ok: false, message: 'parameters must be an object' };
    const field = issue.path.join('.');
    const name = String(issue.path.at(-1) ?? '');
    return {
      ok: false,
      message:
        field && !issue.message.includes(name)
          ? `${field}: ${issue.message}`
          : issue.message,
    };
  }
  return { ok: true, value: result.data };
}

export function parsePullRequestParameters(input: unknown) {
  return parseRuleParameters<PullRequestRuleParameters>(
    PullRequestRuleParametersZodSchema,
    input,
  );
}
