"use server";

import { cookies } from "next/headers";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { fetchClient } from "@/lib/fetch-client";
import { webhookEvents, webhookOwnerSchema } from "@/lib/webhooks";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

const owned = z.object({ owner: webhookOwnerSchema });
const webhook = owned.extend({ webhookId: z.string() });
const events = z
  .array(z.enum(webhookEvents))
  .min(1, "Choose at least one event.");
const url = z.string().trim().url("Enter a full URL.");

const headers = async () => ({ cookie: (await cookies()).toString() });

export const createWebhook = actionClient
  .inputSchema(owned.extend({ url, events }))
  .action(async ({ parsedInput: { owner, ...body } }) => {
    const { data, error } =
      owner.kind === "repository"
        ? await fetchClient.POST(
            "/api/repositories/{username}/{repo}/webhooks",
            {
              params: { path: owner },
              body,
              headers: await headers(),
            },
          )
        : await fetchClient.POST("/api/organizations/{slug}/webhooks", {
            params: { path: owner },
            body,
            headers: await headers(),
          });
    if (error) throw new Error(error.message);
    return data;
  });

export const updateWebhook = actionClient
  .inputSchema(
    webhook.extend({
      url: url.optional(),
      events: events.optional(),
      active: z.boolean().optional(),
    }),
  )
  .action(async ({ parsedInput: { owner, webhookId, ...body } }) => {
    const { error } =
      owner.kind === "repository"
        ? await fetchClient.PATCH(
            "/api/repositories/{username}/{repo}/webhooks/{webhookId}",
            {
              params: { path: { ...owner, webhookId } },
              body,
              headers: await headers(),
            },
          )
        : await fetchClient.PATCH(
            "/api/organizations/{slug}/webhooks/{webhookId}",
            {
              params: { path: { ...owner, webhookId } },
              body,
              headers: await headers(),
            },
          );
    if (error) throw new Error(error.message);
  });

export const deleteWebhook = actionClient
  .inputSchema(webhook)
  .action(async ({ parsedInput: { owner, webhookId } }) => {
    const { error } =
      owner.kind === "repository"
        ? await fetchClient.DELETE(
            "/api/repositories/{username}/{repo}/webhooks/{webhookId}",
            {
              params: { path: { ...owner, webhookId } },
              headers: await headers(),
            },
          )
        : await fetchClient.DELETE(
            "/api/organizations/{slug}/webhooks/{webhookId}",
            {
              params: { path: { ...owner, webhookId } },
              headers: await headers(),
            },
          );
    if (error) throw new Error(error.message);
  });

export const pingWebhook = actionClient
  .inputSchema(webhook)
  .action(async ({ parsedInput: { owner, webhookId } }) => {
    const { error } =
      owner.kind === "repository"
        ? await fetchClient.POST(
            "/api/repositories/{username}/{repo}/webhooks/{webhookId}/pings",
            {
              params: { path: { ...owner, webhookId } },
              headers: await headers(),
            },
          )
        : await fetchClient.POST(
            "/api/organizations/{slug}/webhooks/{webhookId}/pings",
            {
              params: { path: { ...owner, webhookId } },
              headers: await headers(),
            },
          );
    if (error) throw new Error(error.message);
  });

export const redeliverWebhook = actionClient
  .inputSchema(webhook.extend({ deliveryId: z.string() }))
  .action(async ({ parsedInput: { owner, webhookId, deliveryId } }) => {
    const { error } =
      owner.kind === "repository"
        ? await fetchClient.POST(
            "/api/repositories/{username}/{repo}/webhooks/{webhookId}/deliveries/{deliveryId}/redeliveries",
            {
              params: { path: { ...owner, webhookId, deliveryId } },
              headers: await headers(),
            },
          )
        : await fetchClient.POST(
            "/api/organizations/{slug}/webhooks/{webhookId}/deliveries/{deliveryId}/redeliveries",
            {
              params: { path: { ...owner, webhookId, deliveryId } },
              headers: await headers(),
            },
          );
    if (error) throw new Error(error.message);
  });
