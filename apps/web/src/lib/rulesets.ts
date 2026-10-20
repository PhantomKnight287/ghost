import { z } from "zod";

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
    type: "required_linear_history",
    title: "Require linear history",
    description: "Prevent merge commits from being pushed to matching refs.",
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

export const bypassRoles = ["write", "maintain", "admin"] as const;

export const rulesetBodySchema = z.object({
  name: z.string().trim().min(1, "Name the ruleset."),
  target: z.enum(["branch", "tag"]),
  enforcement: z.enum(["active", "disabled"]),
  include: z.array(z.string().min(1)),
  exclude: z.array(z.string().min(1)),
  // Which of role and teamId an actor type needs is the API's to check.
  bypassActors: z.array(
    z.object({
      actorType: z.enum(["RepositoryRole", "Team", "OrganizationAdmin"]),
      role: z.enum(bypassRoles).optional(),
      teamId: z.string().optional(),
      bypassMode: z.enum(["always", "pull_request"]),
    }),
  ),
  rules: z.array(
    z.object({
      type: z.enum([
        "creation",
        "update",
        "deletion",
        "non_fast_forward",
        "required_linear_history",
      ]),
    }),
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
