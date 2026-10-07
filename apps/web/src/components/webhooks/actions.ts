"use server";

import { actionClient } from "@/lib/action-client";
import { z } from "zod";

import { callApi } from "@/lib/api/server";
import { webhookEvents, webhookOwnerSchema } from "@/lib/webhooks";

const owned = z.object({ owner: webhookOwnerSchema });
const webhook = owned.extend({ webhookId: z.string() });
const events = z
  .array(z.enum(webhookEvents))
  .min(1, "Choose at least one event.");
const url = z.string().trim().url("Enter a full URL.");

export const createWebhook = actionClient
  .inputSchema(owned.extend({ url, events }))
  .action(async ({ parsedInput: { owner, ...body } }) => {
    const data = await callApi((client) =>
      owner.kind === "repository"
        ? client.POST("/api/repositories/{username}/{repo}/webhooks", {
            params: { path: owner },
            body,
          })
        : client.POST("/api/organizations/{slug}/webhooks", {
            params: { path: owner },
            body,
          }),
    );
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
    await callApi((client) =>
      owner.kind === "repository"
        ? client.PATCH(
            "/api/repositories/{username}/{repo}/webhooks/{webhookId}",
            {
              params: { path: { ...owner, webhookId } },
              body,
            },
          )
        : client.PATCH("/api/organizations/{slug}/webhooks/{webhookId}", {
            params: { path: { ...owner, webhookId } },
            body,
          }),
    );
  });

export const deleteWebhook = actionClient
  .inputSchema(webhook)
  .action(async ({ parsedInput: { owner, webhookId } }) => {
    await callApi((client) =>
      owner.kind === "repository"
        ? client.DELETE(
            "/api/repositories/{username}/{repo}/webhooks/{webhookId}",
            {
              params: { path: { ...owner, webhookId } },
            },
          )
        : client.DELETE("/api/organizations/{slug}/webhooks/{webhookId}", {
            params: { path: { ...owner, webhookId } },
          }),
    );
  });

export const pingWebhook = actionClient
  .inputSchema(webhook)
  .action(async ({ parsedInput: { owner, webhookId } }) => {
    await callApi((client) =>
      owner.kind === "repository"
        ? client.POST(
            "/api/repositories/{username}/{repo}/webhooks/{webhookId}/pings",
            {
              params: { path: { ...owner, webhookId } },
            },
          )
        : client.POST("/api/organizations/{slug}/webhooks/{webhookId}/pings", {
            params: { path: { ...owner, webhookId } },
          }),
    );
  });

export const rollWebhookSecret = actionClient
  .inputSchema(webhook)
  .action(async ({ parsedInput: { owner, webhookId } }) => {
    const data = await callApi((client) =>
      owner.kind === "repository"
        ? client.POST(
            "/api/repositories/{username}/{repo}/webhooks/{webhookId}/secret",
            {
              params: { path: { ...owner, webhookId } },
            },
          )
        : client.POST("/api/organizations/{slug}/webhooks/{webhookId}/secret", {
            params: { path: { ...owner, webhookId } },
          }),
    );
    return data;
  });

export const redeliverWebhook = actionClient
  .inputSchema(webhook.extend({ deliveryId: z.string() }))
  .action(async ({ parsedInput: { owner, webhookId, deliveryId } }) => {
    await callApi((client) =>
      owner.kind === "repository"
        ? client.POST(
            "/api/repositories/{username}/{repo}/webhooks/{webhookId}/deliveries/{deliveryId}/redeliveries",
            {
              params: { path: { ...owner, webhookId, deliveryId } },
            },
          )
        : client.POST(
            "/api/organizations/{slug}/webhooks/{webhookId}/deliveries/{deliveryId}/redeliveries",
            {
              params: { path: { ...owner, webhookId, deliveryId } },
            },
          ),
    );
  });
