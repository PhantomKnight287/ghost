import {
  type PullRequestRuleParameters,
  PullRequestRuleParametersZodSchema,
} from './rulesets.types.js';

/** Defaults filled in GitHub's way; an invalid body gives the first problem, naming its field. Left out entirely, the parameters are all defaults. */
export function parsePullRequestParameters(
  input: unknown,
):
  | { ok: true; value: PullRequestRuleParameters }
  | { ok: false; message: string } {
  const result = PullRequestRuleParametersZodSchema.safeParse(input ?? {});
  if (input === null || !result.success) {
    const issue = result.error?.issues[0];
    if (!issue) return { ok: false, message: 'parameters must be an object' };
    const field = issue.path.join('.');
    return {
      ok: false,
      message:
        field && !issue.message.includes(field)
          ? `${field}: ${issue.message}`
          : issue.message,
    };
  }
  return { ok: true, value: result.data };
}
