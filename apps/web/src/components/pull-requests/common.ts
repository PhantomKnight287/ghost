import { z } from "zod";

import type { components } from "@/lib/api/v1";
import type { IssueTimelineItem } from "@/types/issue";

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

/** `alice:feat/add-rate_limiter` → `Add rate limiter`: the title a request from that branch starts with. */
export function titleFromBranch(head: string) {
  const name = (head.split(":").at(-1) ?? "").split("/").at(-1) ?? "";
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const mergeMethods = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof mergeMethods)[number];

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

export type ReviewerRow = {
  username: string;
  image: string | null;
  state: "pending" | components["schemas"]["PullRequestReviewState"];
  asCodeOwner: boolean;
};

/** One row per person requested or who reviewed, as GitHub's sidebar lists them: a pending request wins over a past review, a standing verdict over a comment-only review. */
export function reviewerRows({
  requested,
  verdicts,
  timeline,
  author,
}: {
  requested: components["schemas"]["RequestedUserDTO"][];
  verdicts: components["schemas"]["ReviewerDTO"][];
  timeline: IssueTimelineItem[];
  author: string;
}): ReviewerRow[] {
  const rows = new Map<string, ReviewerRow>();
  for (const item of timeline) {
    if (item.kind === "review" && item.state && item.authorUsername !== author)
      rows.set(item.authorUsername, {
        username: item.authorUsername,
        image: item.authorImage,
        state: "commented",
        asCodeOwner: false,
      });
  }
  for (const verdict of verdicts)
    rows.set(verdict.username, { ...verdict, asCodeOwner: false });
  for (const user of requested)
    rows.set(user.username, {
      username: user.username,
      image: user.image,
      state: "pending",
      asCodeOwner: user.asCodeOwner,
    });
  return [...rows.values()];
}
