import { z } from "zod";

export const pullRequestStates = ["open", "closed", "merged"] as const;
export const pullRequestFilters = [...pullRequestStates, "all"] as const;

type PullRequestSide = { username: string | null; ref: string };

/** `owner:branch` when the side lives in another repository than `other`. A deleted repository has no owner left to name. */
export function branchLabel(side: PullRequestSide, other: PullRequestSide) {
  if (side.username === null) return `deleted repository:${side.ref}`;
  return side.username === other.username
    ? side.ref
    : `${side.username}:${side.ref}`;
}

export type PullRequestState = (typeof pullRequestStates)[number];
export type PullRequestFilter = (typeof pullRequestFilters)[number];

// git forbids these in a ref name, and `:` separates the owner in `owner:branch`
const REF = /^[^\s~^:?*[\\]+$/;

export const createPullRequestSchema = z.object({
  title: z
    .string()
    .min(1, "Enter a title.")
    .max(200, "Titles are limited to 200 characters."),
  body: z
    .string()
    .max(20000, "Descriptions are limited to 20000 characters.")
    .optional(),
  base: z
    .string()
    .min(1, "Choose a branch to merge into.")
    .regex(REF, "Invalid branch name."),
  head: z
    .string()
    .min(1, "Choose a branch to merge from.")
    .regex(
      /^[^\s~^:?*[\\]+(:[^\s~^:?*[\\]+)?$/,
      "Use `branch` or `owner:branch`.",
    ),
});

export type CreatePullRequestInput = z.infer<typeof createPullRequestSchema>;
