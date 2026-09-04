"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSafeActionClient } from "next-safe-action";

import { fetchClient } from "@/lib/fetch-client";

import { createRepositorySchema } from "./common";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

export const createRepository = actionClient
  .inputSchema(createRepositorySchema)
  .action(async ({ parsedInput: { owner, name, description } }) => {
    const { data, error } = await fetchClient.POST("/api/repositories", {
      body: { name, description },
      headers: { cookie: (await cookies()).toString() },
    });

    if (error) {
      throw new Error(error.message);
    }

    redirect(`/${owner}/${data.slug}`);
  });
