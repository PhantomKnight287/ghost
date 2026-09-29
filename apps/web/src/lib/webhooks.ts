import { z } from "zod";

import type { components } from "@/lib/api/v1";

export type WebhookEvent = components["schemas"]["WebhookEvent"];

/** In the order the picker lists them. */
export const webhookEventLabels: Record<WebhookEvent, string> = {
  push: "Someone pushes to a branch or tag",
  "issue.opened": "An issue or pull request is opened",
  "issue.commented": "Someone comments on an issue or pull request",
  "issue.assigned": "Someone is assigned",
  "issue.closed": "An issue or pull request is closed",
  "issue.reopened": "An issue or pull request is reopened",
  "pull_request.reviewed": "A pull request is reviewed",
  "pull_request.review_commented": "Someone comments on a pull request's code",
  "pull_request.merged": "A pull request is merged",
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
