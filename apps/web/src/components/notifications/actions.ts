"use server";

import { revalidatePath } from "next/cache";
import { actionClient } from "@/lib/action-client";
import { z } from "zod";

import { callApi } from "@/lib/api/server";

import { watchLevels } from "./common";

const repository = z.object({ username: z.string(), repo: z.string() });

export const setNotificationUnread = actionClient
  .inputSchema(z.object({ id: z.string(), unread: z.boolean() }))
  .action(async ({ parsedInput: { id, unread } }) => {
    await callApi((client) =>
      client.PATCH("/api/notifications/{id}", {
        params: { path: { id } },
        body: { unread },
      }),
    );

    revalidatePath("/notifications");
  });

export const markAllNotificationsRead = actionClient.action(async () => {
  await callApi((client) => client.POST("/api/notifications/read", {}));

  revalidatePath("/notifications");
});

export const setThreadSubscription = actionClient
  .inputSchema(
    repository.extend({ number: z.number(), subscribed: z.boolean() }),
  )
  .action(async ({ parsedInput: { username, repo, number, subscribed } }) => {
    await callApi((client) =>
      client.PUT(
        "/api/repositories/{username}/{repo}/issues/{number}/subscription",
        {
          params: { path: { username, repo, number } },
          body: { subscribed },
        },
      ),
    );

    revalidatePath(`/${username}/${repo}`, "layout");
  });

export const setRepositoryWatch = actionClient
  .inputSchema(repository.extend({ level: z.enum(watchLevels) }))
  .action(async ({ parsedInput: { username, repo, level } }) => {
    await callApi((client) =>
      client.PUT("/api/repositories/{username}/{repo}/subscription", {
        params: { path: { username, repo } },
        body: { level },
      }),
    );

    revalidatePath(`/${username}/${repo}`, "layout");
  });
