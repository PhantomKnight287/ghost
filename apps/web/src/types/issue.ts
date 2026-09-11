import type { components } from "@/lib/api/v1";

export type Issue = components["schemas"]["IssueDTO"];
export type IssueLabel = components["schemas"]["LabelDTO"];
export type IssueComment = components["schemas"]["IssueCommentDTO"];
export type IssueTimelineItem =
  | components["schemas"]["IssueTimelineCommentDTO"]
  | components["schemas"]["IssueTimelineEventItemDTO"];
