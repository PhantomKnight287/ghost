/** Ghost App permissions under GitHub's names, with the levels each allows. `write` includes `read`; `metadata: read` is always granted. */
export const APP_PERMISSIONS = {
  metadata: ["read"],
  contents: ["read", "write"],
  pull_requests: ["read", "write"],
  issues: ["read", "write"],
  statuses: ["read", "write"],
  members: ["read"],
  administration: ["read", "write"],
} as const;

export type AppPermission = keyof typeof APP_PERMISSIONS;
export type AppPermissions = Partial<Record<AppPermission, "read" | "write">>;

/** The permission an app needs at `read` to subscribe to each Ghost webhook event. apps/api checks every event it can send has an entry. */
export const EVENT_PERMISSIONS: Record<string, AppPermission> = {
  push: "contents",
  "issue.opened": "issues",
  "issue.edited": "issues",
  "issue.closed": "issues",
  "issue.reopened": "issues",
  "issue.assigned": "issues",
  "issue.unassigned": "issues",
  "issue.labeled": "issues",
  "issue.unlabeled": "issues",
  "issue.commented": "issues",
  "issue.comment_edited": "issues",
  "issue.comment_deleted": "issues",
  "pull_request.ready_for_review": "pull_requests",
  "pull_request.converted_to_draft": "pull_requests",
  "pull_request.synchronized": "pull_requests",
  "pull_request.merged": "pull_requests",
  "pull_request.reviewed": "pull_requests",
  "pull_request.review_dismissed": "pull_requests",
  "pull_request.review_commented": "pull_requests",
  "pull_request.review_requested": "pull_requests",
  "pull_request.review_request_removed": "pull_requests",
  "label.created": "metadata",
  "label.edited": "metadata",
  "label.deleted": "metadata",
  "release.created": "contents",
  "release.published": "contents",
  "release.edited": "contents",
  "release.deleted": "contents",
  "commit_status.created": "statuses",
  "star.created": "metadata",
  "star.deleted": "metadata",
  "watch.started": "metadata",
  "fork.created": "metadata",
  "repository.edited": "metadata",
  "repository.transferred": "metadata",
  "member.added": "metadata",
  "member.removed": "metadata",
};
