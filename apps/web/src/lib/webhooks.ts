import { z } from "zod";

import type { components } from "@/lib/api/v1";

export type WebhookEvent = components["schemas"]["WebhookEvent"];

/** In the order the picker lists them. */
export const webhookEventLabels: Record<WebhookEvent, string> = {
  push: "Someone pushes to a branch or tag",
  "issue.opened": "An issue or pull request is opened",
  "issue.edited": "An issue or pull request's title or description is edited",
  "issue.closed": "An issue or pull request is closed",
  "issue.reopened": "An issue or pull request is reopened",
  "issue.assigned": "Someone is assigned",
  "issue.unassigned": "Someone is unassigned",
  "issue.labeled": "A label is added to an issue or pull request",
  "issue.unlabeled": "A label is removed from an issue or pull request",
  "issue.commented": "Someone comments on an issue or pull request",
  "issue.comment_edited": "A comment on an issue or pull request is edited",
  "issue.comment_deleted": "A comment on an issue or pull request is deleted",
  "pull_request.ready_for_review":
    "A draft pull request is marked ready for review",
  "pull_request.converted_to_draft": "A pull request is converted to a draft",
  "pull_request.synchronized": "Someone pushes commits to a pull request",
  "pull_request.reviewed": "A pull request is reviewed",
  "pull_request.review_dismissed": "A pull request review is dismissed",
  "pull_request.review_commented": "Someone comments on a pull request's code",
  "pull_request.merged": "A pull request is merged",
  "label.created": "A label is created",
  "label.edited": "A label is edited",
  "label.deleted": "A label is deleted",
  "release.created": "A release is created, draft or not",
  "release.published": "A release is published",
  "release.edited": "A release is edited",
  "release.deleted": "A release is deleted",
  "star.created": "Someone stars the repository",
  "star.deleted": "Someone unstars the repository",
  "watch.started": "Someone starts watching the repository",
  "fork.created": "Someone forks the repository",
  "repository.edited":
    "The repository's name, description, visibility or default branch changes",
  "repository.transferred": "The repository moves to another owner",
  "member.added": "A collaborator accepts an invitation",
  "member.removed": "A collaborator is removed or leaves",
};

export const webhookEvents = Object.keys(webhookEventLabels) as [
  WebhookEvent,
  ...WebhookEvent[],
];

export const webhookOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("repository"),
    username: z.string(),
    repo: z.string(),
  }),
  z.object({ kind: z.literal("organization"), slug: z.string() }),
]);

export type WebhookOwner = z.infer<typeof webhookOwnerSchema>;

/** Where the owner's webhook settings live. */
export function webhooksPath(owner: WebhookOwner) {
  return owner.kind === "repository"
    ? `/${owner.username}/${owner.repo}/settings/webhooks`
    : `/${owner.slug}/settings/webhooks`;
}
