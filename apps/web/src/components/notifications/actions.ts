"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { fetchClient } from "@/lib/fetch-client";

import { watchLevels } from "./common";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

const repository = z.object({ username: z.string(), repo: z.string() });

export const setNotificationUnread = actionClient
  .inputSchema(z.object({ id: z.string(), unread: z.boolean() }))
  .action(async ({ parsedInput: { id, unread } }) => {
    const { error } = await fetchClient.PATCH("/api/notifications/{id}", {
      params: { path: { id } },
      body: { unread },
      headers: { cookie: (await cookies()).toString() },
    });

    if (error) throw new Error(error.message);

    revalidatePath("/notifications");
  });

export const markAllNotificationsRead = actionClient.action(async () => {
  const { error } = await fetchClient.POST("/api/notifications/read", {
    headers: { cookie: (await cookies()).toString() },
  });

  if (error) throw new Error(error.message);

  revalidatePath("/notifications");
});

export const setThreadSubscription = actionClient
  .inputSchema(
    repository.extend({ number: z.number(), subscribed: z.boolean() }),
  )
  .action(async ({ parsedInput: { username, repo, number, subscribed } }) => {
    const { error } = await fetchClient.PUT(
      "/api/repositories/{username}/{repo}/issues/{number}/subscription",
      {
        params: { path: { username, repo, number } },
        body: { subscribed },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}`, "layout");
  });

export const setRepositoryWatch = actionClient
  .inputSchema(repository.extend({ level: z.enum(watchLevels) }))
  .action(async ({ parsedInput: { username, repo, level } }) => {
    const { error } = await fetchClient.PUT(
      "/api/repositories/{username}/{repo}/subscription",
      {
        params: { path: { username, repo } },
        body: { level },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}`, "layout");
  });
