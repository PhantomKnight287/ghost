import { z } from "zod";

import type { IssueTimelineItem } from "@/types/issue";

export const issueStates = ["open", "closed"] as const;
export const issueFilters = [...issueStates, "all"] as const;

export type IssueState = (typeof issueStates)[number];
export type IssueFilter = (typeof issueFilters)[number];

export const issueSorts = ["created", "updated", "comments"] as const;
export type IssueSort = (typeof issueSorts)[number];

export const issueDirections = ["asc", "desc"] as const;
export type IssueDirection = (typeof issueDirections)[number];

export const createIssueSchema = z.object({
  title: z
    .string()
    .min(1, "Enter a title.")
    .max(200, "Titles are limited to 200 characters."),
  body: z
    .string()
    .max(20000, "Descriptions are limited to 20000 characters.")
    .optional(),
  labels: z.array(z.string()).max(20).optional(),
  assignees: z.array(z.string()).max(10).optional(),
});

export type CreateIssueInput = z.infer<typeof createIssueSchema>;

export const createLabelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name.")
    .max(50, "Names are limited to 50 characters."),
  description: z
    .string()
    .max(100, "Descriptions are limited to 100 characters.")
    .optional(),
  color: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/, "Use 6 hex characters, e.g. d73a4a."),
});

export type CreateLabelInput = z.infer<typeof createLabelSchema>;

// `null` clears the description, which is why it is not just `.optional()`.
export const updateLabelSchema = createLabelSchema.extend({
  description: createLabelSchema.shape.description.unwrap().nullable(),
});

export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;

/** What happened, without who did it: the timeline links the actor in front of it. */
export function eventDescription(
  event: {
    type: string;
    labelName: string | null;
    assigneeUsername: string | null;
    oldTitle: string | null;
    newTitle: string | null;
  },
  noun: "issue" | "pull request" = "issue",
): string {
  switch (event.type) {
    case "opened":
      return `opened this ${noun}`;
    case "closed":
      return `closed this ${noun}`;
    case "reopened":
      return `reopened this ${noun}`;
    case "merged":
      return `merged this ${noun}`;
    case "ready_for_review":
      return `marked this ${noun} as ready for review`;
    case "converted_to_draft":
      return `marked this ${noun} as a draft`;
    case "renamed":
      return `renamed this ${noun}`;
    case "edited":
      return `edited the description`;
    case "labeled":
      return `added the “${event.labelName ?? "unknown"}” label`;
    case "unlabeled":
      return `removed the “${event.labelName ?? "unknown"}” label`;
    case "assigned":
      return `assigned ${event.assigneeUsername ?? "someone"}`;
    case "unassigned":
      return `unassigned ${event.assigneeUsername ?? "someone"}`;
    default:
      return `updated this ${noun}`;
  }
}

type TimelineEvent = Extract<IssueTimelineItem, { kind: "event" }>["event"];

const isCommitBy = (item: IssueTimelineItem | undefined, actor: string) =>
  item?.kind === "event" &&
  item.event.type === "committed" &&
  item.event.actorUsername === actor;

/** The commits one person added in a row, starting at `index`, which read as one block; null for a commit that continues the block before it. */
export function commitRunAt(
  items: IssueTimelineItem[],
  index: number,
): TimelineEvent[] | null {
  const item = items[index];
  if (item?.kind !== "event") return null;
  const actor = item.event.actorUsername;
  if (isCommitBy(items[index - 1], actor)) return null;

  const run: TimelineEvent[] = [];
  for (let at = index; isCommitBy(items[at], actor); at++) {
    const next = items[at];
    if (next.kind === "event") run.push(next.event);
  }
  return run;
}
