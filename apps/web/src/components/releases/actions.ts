"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { fetchClient } from "@/lib/fetch-client";

import { releasePath, releaseSchema } from "./common";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

const repository = z.object({ username: z.string(), repo: z.string() });

export const createRelease = actionClient
  .inputSchema(
    releaseSchema.extend(repository.shape).extend({ isDraft: z.boolean() }),
  )
  .action(async ({ parsedInput: { username, repo, ...body } }) => {
    const { data, error } = await fetchClient.POST(
      "/api/repositories/{username}/{repo}/releases",
      {
        params: { path: { username, repo } },
        body: { ...body, target: body.target || undefined },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}`, "layout");
    redirect(releasePath(username, repo, data.tagName));
  });

export const updateRelease = actionClient
  .inputSchema(
    releaseSchema
      .omit({ tagName: true, target: true })
      .partial()
      .extend(repository.shape)
      .extend({ id: z.string(), isDraft: z.boolean().optional() }),
  )
  .action(async ({ parsedInput: { username, repo, id, ...body } }) => {
    const { data, error } = await fetchClient.PATCH(
      "/api/repositories/{username}/{repo}/releases/{id}",
      {
        params: { path: { username, repo, id } },
        body,
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}`, "layout");
    redirect(releasePath(username, repo, data.tagName));
  });

export const deleteRelease = actionClient
  .inputSchema(repository.extend({ id: z.string() }))
  .action(async ({ parsedInput: { username, repo, id } }) => {
    const { error } = await fetchClient.DELETE(
      "/api/repositories/{username}/{repo}/releases/{id}",
      {
        params: { path: { username, repo, id } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}`, "layout");
    redirect(`/${username}/${repo}/releases`);
  });
