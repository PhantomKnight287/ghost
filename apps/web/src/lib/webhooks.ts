import { z } from "zod";

import { WEBHOOK_EVENTS, type WebhookEvent } from "@ghost/webhooks";

export { type WebhookEvent, webhookEvents } from "@ghost/webhooks";

export const webhookEventLabels = Object.fromEntries(
  Object.entries(WEBHOOK_EVENTS).map(([event, { label }]) => [event, label]),
) as Record<WebhookEvent, string>;

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
