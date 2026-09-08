"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { fetchClient } from "@/lib/fetch-client";

import { createPullRequestSchema } from "./common";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

const target = z.object({
  username: z.string(),
  repo: z.string(),
  number: z.number(),
});

export const createPullRequest = actionClient
  .inputSchema(
    createPullRequestSchema.extend({ username: z.string(), repo: z.string() }),
  )
  .action(
    async ({ parsedInput: { username, repo, title, body, base, head } }) => {
      const { data, error } = await fetchClient.POST(
        "/api/repositories/{username}/{repo}/pulls",
        {
          params: { path: { username, repo } },
          body: { title, body, base, head },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      redirect(`/${username}/${repo}/pulls/${data.number}`);
    },
  );

export const mergePullRequest = actionClient
  .inputSchema(target.extend({ title: z.string().optional() }))
  .action(async ({ parsedInput: { username, repo, number, title } }) => {
    const { data, error } = await fetchClient.POST(
      "/api/repositories/{username}/{repo}/pulls/{number}/merge",
      {
        params: { path: { username, repo, number } },
        body: { title },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}/pulls/${number}`);
    return data;
  });

export const closePullRequest = actionClient
  .inputSchema(target)
  .action(async ({ parsedInput: { username, repo, number } }) => {
    const { error } = await fetchClient.PATCH(
      "/api/repositories/{username}/{repo}/pulls/{number}/close",
      {
        params: { path: { username, repo, number } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}/pulls/${number}`);
  });
