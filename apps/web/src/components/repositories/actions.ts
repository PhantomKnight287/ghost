"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { fetchClient } from "@/lib/fetch-client";

import { createRepositorySchema, forkRepositorySchema } from "./common";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

export const createRepository = actionClient
  .inputSchema(createRepositorySchema)
  .action(async ({ parsedInput: { owner, name, description,visibility } }) => {
    const { data, error } = await fetchClient.POST("/api/repositories", {
      body: { name, description, visibility },
      headers: { cookie: (await cookies()).toString() },
    });

    if (error) {
      throw new Error(error.message);
    }

    redirect(`/${owner}/${data.slug}`);
  });

export const forkRepository = actionClient
  .inputSchema(
    forkRepositorySchema.extend({
      parentUsername: z.string(),
      parentSlug: z.string(),
    }),
  )
  .action(
    async ({
      parsedInput: {
        parentUsername,
        parentSlug,
        name,
        description,
        visibility,
      },
    }) => {
      const { data, error } = await fetchClient.POST(
        "/api/repositories/{username}/{slug}/fork",
        {
          params: {
            path: { username: parentUsername, slug: parentSlug },
          },
          body: { name, description, visibility },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) {
        throw new Error(error.message);
      }

      redirect(`/${data.username}/${data.slug}`);
    },
  );
