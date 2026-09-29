"use server";

import { cookies } from "next/headers";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { fetchClient } from "@/lib/fetch-client";
import { webhookEvents } from "@/lib/webhook-events";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

const repositoryPath = z.object({ username: z.string(), slug: z.string() });
const webhookPath = repositoryPath.extend({ webhookId: z.string() });
const events = z
  .array(z.enum(webhookEvents))
  .min(1, "Choose at least one event.");

const headers = async () => ({ cookie: (await cookies()).toString() });

export const createWebhook = actionClient
  .inputSchema(
    repositoryPath.extend({
      url: z.string().trim().url("Enter a full URL."),
      events,
    }),
  )
  .action(async ({ parsedInput: { username, slug, url, events } }) => {
    const { data, error } = await fetchClient.POST(
      "/api/repositories/{username}/{repo}/webhooks",
      {
        params: { path: { username, repo: slug } },
        body: { url, events },
        headers: await headers(),
      },
    );
    if (error) throw new Error(error.message);
    return data;
  });

export const updateWebhook = actionClient
  .inputSchema(
    webhookPath.extend({
      url: z.string().trim().url("Enter a full URL.").optional(),
      events: events.optional(),
      active: z.boolean().optional(),
    }),
  )
  .action(async ({ parsedInput: { username, slug, webhookId, ...body } }) => {
    const { error } = await fetchClient.PATCH(
      "/api/repositories/{username}/{repo}/webhooks/{webhookId}",
      {
        params: { path: { username, repo: slug, webhookId } },
        body,
        headers: await headers(),
      },
    );
    if (error) throw new Error(error.message);
  });

export const deleteWebhook = actionClient
  .inputSchema(webhookPath)
  .action(async ({ parsedInput: { username, slug, webhookId } }) => {
    const { error } = await fetchClient.DELETE(
      "/api/repositories/{username}/{repo}/webhooks/{webhookId}",
      {
        params: { path: { username, repo: slug, webhookId } },
        headers: await headers(),
      },
    );
    if (error) throw new Error(error.message);
  });

export const pingWebhook = actionClient
  .inputSchema(webhookPath)
  .action(async ({ parsedInput: { username, slug, webhookId } }) => {
    const { error } = await fetchClient.POST(
      "/api/repositories/{username}/{repo}/webhooks/{webhookId}/pings",
      {
        params: { path: { username, repo: slug, webhookId } },
        headers: await headers(),
      },
    );
    if (error) throw new Error(error.message);
  });

export const redeliverWebhook = actionClient
  .inputSchema(webhookPath.extend({ deliveryId: z.string() }))
  .action(
    async ({ parsedInput: { username, slug, webhookId, deliveryId } }) => {
      const { error } = await fetchClient.POST(
        "/api/repositories/{username}/{repo}/webhooks/{webhookId}/deliveries/{deliveryId}/redeliveries",
        {
          params: { path: { username, repo: slug, webhookId, deliveryId } },
          headers: await headers(),
        },
      );
      if (error) throw new Error(error.message);
    },
  );
