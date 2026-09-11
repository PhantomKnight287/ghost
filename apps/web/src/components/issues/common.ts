import { z } from "zod";

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

export function eventDescription(event: {
  type: string;
  actorUsername: string;
  labelName: string | null;
  assigneeUsername: string | null;
  oldTitle: string | null;
  newTitle: string | null;
}): string {
  const actor = event.actorUsername || "Someone";

  switch (event.type) {
    case "opened":
      return `${actor} opened this issue`;
    case "closed":
      return `${actor} closed this issue`;
    case "reopened":
      return `${actor} reopened this issue`;
    case "renamed":
      return `${actor} renamed this issue`;
    case "edited":
      return `${actor} edited the description`;
    case "labeled":
      return `${actor} added the “${event.labelName ?? "unknown"}” label`;
    case "unlabeled":
      return `${actor} removed the “${event.labelName ?? "unknown"}” label`;
    case "assigned":
      return `${actor} assigned ${event.assigneeUsername ?? "someone"}`;
    case "unassigned":
      return `${actor} unassigned ${event.assigneeUsername ?? "someone"}`;
    default:
      return `${actor} updated this issue`;
  }
}
