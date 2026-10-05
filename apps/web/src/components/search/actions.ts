"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { searchCode } from "@/lib/api/code-search";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

export const loadCodeSearchPage = actionClient
  .inputSchema(
    z.object({
      query: z.string().min(1),
      offset: z.number().int().min(0),
      repository: z.object({ owner: z.string(), slug: z.string() }).optional(),
    }),
  )
  .action(async ({ parsedInput }) => {
    const { data, error, nextOffset } = await searchCode(parsedInput);
    if (error) throw new Error(error.message);

    return { files: data.files, nextOffset };
  });
