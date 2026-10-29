import type { AppPermission } from "@ghost/permissions";

/** What an owner picks per permission; `metadata` is always read and `administration` has no effect yet, so neither is offered. */
export const PERMISSIONS: {
  name: Exclude<AppPermission, "metadata" | "administration">;
  label: string;
  detail: string;
  levels: ("read" | "write")[];
}[] = [
  {
    name: "contents",
    label: "Contents",
    detail:
      "Files, commits and diffs, clone and fetch; write adds push, refs and releases.",
    levels: ["read", "write"],
  },
  {
    name: "pull_requests",
    label: "Pull requests",
    detail:
      "Pull requests, reviews and review comments; write adds opening, reviewing, commenting and merging.",
    levels: ["read", "write"],
  },
  {
    name: "issues",
    label: "Issues",
    detail:
      "Issues, comments and labels; write adds creating, editing, commenting and labelling.",
    levels: ["read", "write"],
  },
  {
    name: "statuses",
    label: "Commit statuses",
    detail: "Commit statuses; write adds posting them, as CI does.",
    levels: ["read", "write"],
  },
  {
    name: "members",
    label: "Organization members",
    detail: "Members and teams of the organizations it is installed on.",
    levels: ["read"],
  },
];
