"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { actionClient } from "@/lib/action-client";
import { callApi } from "@/lib/api/server";
import { rulesetBodySchema } from "@/lib/rulesets";

const repository = z.object({ username: z.string(), repo: z.string() });
const rulesetPath = repository.extend({ id: z.string() });

export const createRuleset = actionClient
  .inputSchema(repository.extend({ body: rulesetBodySchema }))
  .action(async ({ parsedInput: { username, repo, body } }) => {
    await callApi((client) =>
      client.POST("/api/repositories/{username}/{repo}/rulesets", {
        params: { path: { username, repo } },
        body,
      }),
    );
    revalidatePath(`/${username}/${repo}`, "layout");
    redirect(`/${username}/${repo}/settings/rules`);
  });

export const updateRuleset = actionClient
  .inputSchema(rulesetPath.extend({ body: rulesetBodySchema }))
  .action(async ({ parsedInput: { username, repo, id, body } }) => {
    await callApi((client) =>
      client.PUT("/api/repositories/{username}/{repo}/rulesets/{id}", {
        params: { path: { username, repo, id } },
        body,
      }),
    );
    revalidatePath(`/${username}/${repo}`, "layout");
  });

export const deleteRuleset = actionClient
  .inputSchema(rulesetPath)
  .action(async ({ parsedInput: { username, repo, id } }) => {
    await callApi((client) =>
      client.DELETE("/api/repositories/{username}/{repo}/rulesets/{id}", {
        params: { path: { username, repo, id } },
      }),
    );
    revalidatePath(`/${username}/${repo}`, "layout");
    redirect(`/${username}/${repo}/settings/rules`);
  });

export const previewRuleset = actionClient
  .inputSchema(
    repository.extend({
      patterns: rulesetBodySchema.pick({
        target: true,
        include: true,
        exclude: true,
      }),
    }),
  )
  .action(async ({ parsedInput: { username, repo, patterns } }) =>
    callApi((client) =>
      client.POST("/api/repositories/{username}/{repo}/rulesets/preview", {
        params: { path: { username, repo } },
        body: patterns,
      }),
    ),
  );
