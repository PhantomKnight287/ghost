"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { fetchClient } from "@/lib/fetch-client";

import {
  createIssueSchema,
  createLabelSchema,
  updateLabelSchema,
} from "./common";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

const target = z.object({
  username: z.string(),
  repo: z.string(),
  number: z.number(),
});

function issuePath(username: string, repo: string, number?: number) {
  return number === undefined
    ? `/${username}/${repo}/issues`
    : `/${username}/${repo}/issues/${number}`;
}

export const createIssue = actionClient
  .inputSchema(
    createIssueSchema.extend({ username: z.string(), repo: z.string() }),
  )
  .action(
    async ({
      parsedInput: { username, repo, title, body, labels, assignees },
    }) => {
      const { data, error } = await fetchClient.POST(
        "/api/repositories/{username}/{repo}/issues",
        {
          params: { path: { username, repo } },
          body: { title, body, labels, assignees },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      redirect(`/${username}/${repo}/issues/${data.number}`);
    },
  );

export const updateIssue = actionClient
  .inputSchema(
    target.extend({
      title: z
        .string()
        .trim()
        .min(1, "Enter a title.")
        .max(200, "Titles are limited to 200 characters.")
        .optional(),
      body: z
        .string()
        .max(20000, "Descriptions are limited to 20000 characters.")
        .nullable()
        .optional(),
    }),
  )
  .action(async ({ parsedInput: { username, repo, number, title, body } }) => {
    const { data, error } = await fetchClient.PATCH(
      "/api/repositories/{username}/{repo}/issues/{number}",
      {
        params: { path: { username, repo, number } },
        body: { title, body },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(issuePath(username, repo, number));
    return data;
  });

export const closeIssue = actionClient
  .inputSchema(target)
  .action(async ({ parsedInput: { username, repo, number } }) => {
    const { error } = await fetchClient.POST(
      "/api/repositories/{username}/{repo}/issues/{number}/close",
      {
        params: { path: { username, repo, number } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(issuePath(username, repo, number));
    revalidatePath(issuePath(username, repo));
  });

export const reopenIssue = actionClient
  .inputSchema(target)
  .action(async ({ parsedInput: { username, repo, number } }) => {
    const { error } = await fetchClient.POST(
      "/api/repositories/{username}/{repo}/issues/{number}/reopen",
      {
        params: { path: { username, repo, number } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(issuePath(username, repo, number));
    revalidatePath(issuePath(username, repo));
  });

export const commentOnIssue = actionClient
  .inputSchema(
    target.extend({
      body: z
        .string()
        .trim()
        .min(1, "Write something first.")
        .max(20000, "Comments are limited to 20000 characters."),
    }),
  )
  .action(async ({ parsedInput: { username, repo, number, body } }) => {
    const { data, error } = await fetchClient.POST(
      "/api/repositories/{username}/{repo}/issues/{number}/comments",
      {
        params: { path: { username, repo, number } },
        body: { body },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(issuePath(username, repo, number));
    return data;
  });

export const updateIssueComment = actionClient
  .inputSchema(
    target.extend({
      commentId: z.string(),
      body: z
        .string()
        .trim()
        .min(1, "Write something first.")
        .max(20000, "Comments are limited to 20000 characters."),
    }),
  )
  .action(
    async ({ parsedInput: { username, repo, number, commentId, body } }) => {
      const { data, error } = await fetchClient.PATCH(
        "/api/repositories/{username}/{repo}/issues/{number}/comments/{commentId}",
        {
          params: { path: { username, repo, number, commentId } },
          body: { body },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      revalidatePath(issuePath(username, repo, number));
      return data;
    },
  );

export const deleteIssueComment = actionClient
  .inputSchema(target.extend({ commentId: z.string() }))
  .action(async ({ parsedInput: { username, repo, number, commentId } }) => {
    const { error } = await fetchClient.DELETE(
      "/api/repositories/{username}/{repo}/issues/{number}/comments/{commentId}",
      {
        params: { path: { username, repo, number, commentId } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(issuePath(username, repo, number));
  });

export const setIssueLabels = actionClient
  .inputSchema(target.extend({ names: z.array(z.string()) }))
  .action(async ({ parsedInput: { username, repo, number, names } }) => {
    const { data, error } = await fetchClient.PUT(
      "/api/repositories/{username}/{repo}/issues/{number}/labels",
      {
        params: { path: { username, repo, number } },
        body: { names },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(issuePath(username, repo, number));
    return data;
  });

export const setIssueAssignees = actionClient
  .inputSchema(target.extend({ usernames: z.array(z.string()) }))
  .action(async ({ parsedInput: { username, repo, number, usernames } }) => {
    const { data, error } = await fetchClient.PUT(
      "/api/repositories/{username}/{repo}/issues/{number}/assignees",
      {
        params: { path: { username, repo, number } },
        body: { usernames },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(issuePath(username, repo, number));
    return data;
  });

export const createLabel = actionClient
  .inputSchema(
    createLabelSchema.extend({ username: z.string(), repo: z.string() }),
  )
  .action(
    async ({ parsedInput: { username, repo, name, description, color } }) => {
      const { data, error } = await fetchClient.POST(
        "/api/repositories/{username}/{repo}/labels",
        {
          params: { path: { username, repo } },
          body: { name, description, color },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      revalidatePath(`/${username}/${repo}/labels`);
      // A label change can surface on any issue in the repository.
      revalidatePath(issuePath(username, repo), "layout");
      return data;
    },
  );

export const updateLabel = actionClient
  .inputSchema(
    updateLabelSchema.extend({
      username: z.string(),
      repo: z.string(),
      labelId: z.string(),
    }),
  )
  .action(
    async ({
      parsedInput: { username, repo, labelId, name, description, color },
    }) => {
      const { data, error } = await fetchClient.PATCH(
        "/api/repositories/{username}/{repo}/labels/{labelId}",
        {
          params: { path: { username, repo, labelId } },
          body: { name, description, color },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      revalidatePath(`/${username}/${repo}/labels`);
      // A label change can surface on any issue in the repository.
      revalidatePath(issuePath(username, repo), "layout");
      return data;
    },
  );

export const deleteLabel = actionClient
  .inputSchema(
    z.object({ username: z.string(), repo: z.string(), labelId: z.string() }),
  )
  .action(async ({ parsedInput: { username, repo, labelId } }) => {
    const { error } = await fetchClient.DELETE(
      "/api/repositories/{username}/{repo}/labels/{labelId}",
      {
        params: { path: { username, repo, labelId } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}/labels`);
    // A label change can surface on any issue in the repository.
    revalidatePath(issuePath(username, repo), "layout");
  });
