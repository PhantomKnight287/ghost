import type { AppPermission } from "@ghost/permissions";

/** Every event a webhook can subscribe to, in the order the picker lists them, with the app permission it needs at `read`. Pull requests have their own lifecycle events; labels, assignees and comments use the `issue.*` names for both. */
export const WEBHOOK_EVENTS = {
  push: { label: "Someone pushes to a branch or tag", permission: "contents" },
  "issue.opened": { label: "An issue is opened", permission: "issues" },
  "issue.edited": {
    label: "An issue's title or description is edited",
    permission: "issues",
  },
  "issue.closed": { label: "An issue is closed", permission: "issues" },
  "issue.reopened": { label: "An issue is reopened", permission: "issues" },
  "issue.assigned": { label: "Someone is assigned", permission: "issues" },
  "issue.unassigned": { label: "Someone is unassigned", permission: "issues" },
  "issue.labeled": {
    label: "A label is added to an issue or pull request",
    permission: "issues",
  },
  "issue.unlabeled": {
    label: "A label is removed from an issue or pull request",
    permission: "issues",
  },
  "issue.commented": {
    label: "Someone comments on an issue or pull request",
    permission: "issues",
  },
  "issue.comment_edited": {
    label: "A comment on an issue or pull request is edited",
    permission: "issues",
  },
  "issue.comment_deleted": {
    label: "A comment on an issue or pull request is deleted",
    permission: "issues",
  },
  "pull_request.opened": {
    label: "A pull request is opened",
    permission: "pull_requests",
  },
  "pull_request.edited": {
    label: "A pull request's title or description is edited",
    permission: "pull_requests",
  },
  "pull_request.closed": {
    label: "A pull request is closed without merging",
    permission: "pull_requests",
  },
  "pull_request.reopened": {
    label: "A pull request is reopened",
    permission: "pull_requests",
  },
  "pull_request.ready_for_review": {
    label: "A draft pull request is marked ready for review",
    permission: "pull_requests",
  },
  "pull_request.converted_to_draft": {
    label: "A pull request is converted to a draft",
    permission: "pull_requests",
  },
  "pull_request.synchronized": {
    label: "Someone pushes commits to a pull request",
    permission: "pull_requests",
  },
  "pull_request.reviewed": {
    label: "A pull request is reviewed",
    permission: "pull_requests",
  },
  "pull_request.review_dismissed": {
    label: "A pull request review is dismissed",
    permission: "pull_requests",
  },
  "pull_request.review_commented": {
    label: "Someone comments on a pull request's code",
    permission: "pull_requests",
  },
  "pull_request.review_requested": {
    label: "A review is requested on a pull request",
    permission: "pull_requests",
  },
  "pull_request.review_request_removed": {
    label: "A review request is removed from a pull request",
    permission: "pull_requests",
  },
  "pull_request.merged": {
    label: "A pull request is merged",
    permission: "pull_requests",
  },
  "commit_status.created": {
    label: "A commit status is reported",
    permission: "statuses",
  },
  "label.created": { label: "A label is created", permission: "metadata" },
  "label.edited": { label: "A label is edited", permission: "metadata" },
  "label.deleted": { label: "A label is deleted", permission: "metadata" },
  "release.created": {
    label: "A release is created, draft or not",
    permission: "contents",
  },
  "release.published": {
    label: "A release is published",
    permission: "contents",
  },
  "release.edited": { label: "A release is edited", permission: "contents" },
  "release.deleted": { label: "A release is deleted", permission: "contents" },
  "star.created": {
    label: "Someone stars the repository",
    permission: "metadata",
  },
  "star.deleted": {
    label: "Someone unstars the repository",
    permission: "metadata",
  },
  "watch.started": {
    label: "Someone starts watching the repository",
    permission: "metadata",
  },
  "fork.created": {
    label: "Someone forks the repository",
    permission: "metadata",
  },
  "repository.edited": {
    label:
      "The repository's name, description, visibility or default branch changes",
    permission: "metadata",
  },
  "repository.transferred": {
    label: "The repository moves to another owner",
    permission: "metadata",
  },
  "member.added": {
    label: "A collaborator accepts an invitation",
    permission: "metadata",
  },
  "member.removed": {
    label: "A collaborator is removed or leaves",
    permission: "metadata",
  },
} as const satisfies Record<
  string,
  { label: string; permission: AppPermission }
>;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

export const webhookEvents = Object.keys(WEBHOOK_EVENTS) as [
  WebhookEvent,
  ...WebhookEvent[],
];

/** Sent to an app about its own installations, whatever it subscribed to. Never subscribable. */
export const INSTALLATION_EVENTS = [
  "installation.created",
  "installation.deleted",
  "installation.suspended",
  "installation.unsuspended",
  "installation.repositories_added",
  "installation.repositories_removed",
  "installation.new_permissions_accepted",
] as const;

export type InstallationEvent = (typeof INSTALLATION_EVENTS)[number];
