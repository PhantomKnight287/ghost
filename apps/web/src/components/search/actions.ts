"use server";

import { actionClient } from "@/lib/action-client";
import { z } from "zod";

import { searchCode } from "@/lib/api/code-search";

export const loadCodeSearchPage = actionClient
  .inputSchema(
    z.object({
      query: z.string().min(1),
      cursor: z.string(),
      repository: z.object({ owner: z.string(), slug: z.string() }).optional(),
    }),
  )
  .action(async ({ parsedInput }) => {
    const { data, error } = await searchCode(parsedInput);
    if (error) throw new Error(error.message);

    return { files: data.files, nextCursor: data.nextCursor };
  });
