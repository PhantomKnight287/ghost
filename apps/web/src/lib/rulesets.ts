import { z } from "zod";

import { mergeMethods } from "@/components/pull-requests/common";
import type { components } from "@/lib/api/v1";

export type Ruleset = components["schemas"]["RulesetDTO"];
export type RulesetBody = components["schemas"]["RulesetRequestDTO"];
export type RuleType = components["schemas"]["RulesetRuleDTO"]["type"];
export type BypassActor = components["schemas"]["RulesetBypassActorDTO"];
export type RulesetTarget = RulesetBody["target"];

/** GitHub's names and descriptions, in GitHub's order. */
export const rules: { type: RuleType; title: string; description: string }[] = [
  {
    type: "creation",
    title: "Restrict creations",
    description:
      "Only allow users with bypass permission to create matching refs.",
  },
  {
    type: "update",
    title: "Restrict updates",
    description:
      "Only allow users with bypass permission to update matching refs.",
  },
  {
    type: "deletion",
    title: "Restrict deletions",
    description:
      "Only allow users with bypass permissions to delete matching refs.",
  },
  {
    type: "pull_request",
    title: "Require a pull request before merging",
    description:
      "Require all commits be made to a non-target branch and submitted via a pull request before they can be merged.",
  },
  {
    type: "required_status_checks",
    title: "Require status checks to pass",
    description:
      "Choose which status checks must pass before the ref is updated. When enabled, commits must first be pushed to another ref where the checks pass.",
  },
  {
    type: "required_linear_history",
    title: "Require linear history",
    description: "Prevent merge commits from being pushed to matching refs.",
  },
  {
    type: "required_signatures",
    title: "Require signed commits",
    description:
      "Commits pushed to matching refs must have verified signatures.",
  },
  {
    type: "non_fast_forward",
    title: "Block force pushes",
    description: "Prevent users with push access from force pushing to refs.",
  },
];

export const ruleTitles = Object.fromEntries(
  rules.map(({ type, title }) => [type, title]),
) as Record<RuleType, string>;

export const pullRequestParametersSchema = z.object({
  required_approving_review_count: z.number().int().min(0).max(10),
  dismiss_stale_reviews_on_push: z.boolean(),
  require_code_owner_review: z.boolean(),
  require_last_push_approval: z.boolean(),
  required_review_thread_resolution: z.boolean(),
  allowed_merge_methods: z
    .array(z.enum(mergeMethods))
    .min(1, "Allow at least one merge method."),
});
export type PullRequestParameters = z.infer<typeof pullRequestParametersSchema>;

/** GitHub's defaults for a new rule. */
export const defaultPullRequestParameters: PullRequestParameters = {
  required_approving_review_count: 0,
  dismiss_stale_reviews_on_push: false,
  require_code_owner_review: false,
  require_last_push_approval: false,
  required_review_thread_resolution: false,
  allowed_merge_methods: [...mergeMethods],
};

/** GitHub's labels and descriptions for the rule's switches, in GitHub's order. */
export const pullRequestFlags: {
  key: Exclude<
    keyof PullRequestParameters,
    "required_approving_review_count" | "allowed_merge_methods"
  >;
  title: string;
  description: string;
}[] = [
  {
    key: "dismiss_stale_reviews_on_push",
    title: "Dismiss stale pull request approvals when new commits are pushed",
    description:
      "New, reviewable commits pushed will dismiss previous pull request review approvals.",
  },
  {
    key: "require_code_owner_review",
    title: "Require review from Code Owners",
    description:
      "Require an approving review in pull requests that modify files that have a designated code owner.",
  },
  {
    key: "require_last_push_approval",
    title: "Require approval of the most recent reviewable push",
    description:
      "Whether the most recent reviewable push must be approved by someone other than the person who pushed it.",
  },
  {
    key: "required_review_thread_resolution",
    title: "Require conversation resolution before merging",
    description:
      "All conversations on code must be resolved before a pull request can be merged.",
  },
];

export const statusCheckParametersSchema = z.object({
  required_status_checks: z.array(
    z.object({
      context: z.string().min(1),
      integration_id: z.number().int().positive().optional(),
    }),
  ),
  strict_required_status_checks_policy: z.boolean(),
  do_not_enforce_on_create: z.boolean(),
});
export type StatusCheckParameters = z.infer<typeof statusCheckParametersSchema>;

export const defaultStatusCheckParameters: StatusCheckParameters = {
  required_status_checks: [],
  strict_required_status_checks_policy: false,
  do_not_enforce_on_create: false,
};

export const bypassRoles = ["write", "maintain", "admin"] as const;

export const rulesetBodySchema = z.object({
  name: z.string().trim().min(1, "Name the ruleset."),
  target: z.enum(["branch", "tag"]),
  enforcement: z.enum(["active", "evaluate", "disabled"]),
  include: z.array(z.string().min(1)),
  exclude: z.array(z.string().min(1)),
  // Which of role, teamId and appId an actor type needs is the API's to check.
  bypassActors: z.array(
    z.object({
      actorType: z.enum([
        "RepositoryRole",
        "Team",
        "OrganizationAdmin",
        "Integration",
      ]),
      role: z.enum(bypassRoles).optional(),
      teamId: z.string().optional(),
      appId: z.number().int().optional(),
      bypassMode: z.enum(["always", "pull_request"]),
    }),
  ),
  rules: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.enum([
          "creation",
          "update",
          "deletion",
          "non_fast_forward",
          "required_linear_history",
          "required_signatures",
        ]),
      }),
      z.object({
        type: z.literal("required_status_checks"),
        parameters: statusCheckParametersSchema,
      }),
      z.object({
        type: z.literal("pull_request"),
        parameters: pullRequestParametersSchema,
      }),
    ]),
  ),
});

/** How a stored pattern reads in the form: without the prefix its target implies, as GitHub shows it. */
export function patternLabel(target: RulesetTarget, pattern: string) {
  if (pattern === "~DEFAULT_BRANCH") return "Default branch";
  if (pattern === "~ALL")
    return target === "branch" ? "All branches" : "All tags";
  return pattern.replace(
    target === "branch" ? /^refs\/heads\// : /^refs\/tags\//,
    "",
  );
}
