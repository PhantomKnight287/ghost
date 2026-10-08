"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionClient } from "@/lib/action-client";
import { z } from "zod";

import { callApi } from "@/lib/api/server";

import { releaseSchema } from "./common";

const repository = z.object({ username: z.string(), repo: z.string() });

export const createRelease = actionClient
  .inputSchema(
    releaseSchema.extend(repository.shape).extend({ isDraft: z.boolean() }),
  )
  .action(async ({ parsedInput: { username, repo, ...body } }) => {
    const data = await callApi((client) =>
      client.POST("/api/repositories/{username}/{repo}/releases", {
        params: { path: { username, repo } },
        body: { ...body, target: body.target || undefined },
      }),
    );

    revalidatePath(`/${username}/${repo}`, "layout");
    // the form still has assets to upload, and navigates itself once they are in
    return { id: data.id, tagName: data.tagName };
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
    const data = await callApi((client) =>
      client.PATCH("/api/repositories/{username}/{repo}/releases/{id}", {
        params: { path: { username, repo, id } },
        body,
      }),
    );

    revalidatePath(`/${username}/${repo}`, "layout");
    return { id: data.id, tagName: data.tagName };
  });

export const deleteRelease = actionClient
  .inputSchema(repository.extend({ id: z.string() }))
  .action(async ({ parsedInput: { username, repo, id } }) => {
    await callApi((client) =>
      client.DELETE("/api/repositories/{username}/{repo}/releases/{id}", {
        params: { path: { username, repo, id } },
      }),
    );

    revalidatePath(`/${username}/${repo}`, "layout");
    redirect(`/${username}/${repo}/releases`);
  });

export const deleteReleaseAsset = actionClient
  .inputSchema(repository.extend({ assetId: z.string() }))
  .action(async ({ parsedInput: { username, repo, assetId } }) => {
    await callApi((client) =>
      client.DELETE(
        "/api/repositories/{username}/{repo}/releases/assets/{assetId}",
        {
          params: { path: { username, repo, assetId } },
        },
      ),
    );

    revalidatePath(`/${username}/${repo}`, "layout");
  });
