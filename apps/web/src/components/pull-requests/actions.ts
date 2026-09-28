"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { fetchClient } from "@/lib/fetch-client";

import { createPullRequestSchema, mergeMethods } from "./common";

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
    createPullRequestSchema.extend({
      username: z.string(),
      repo: z.string(),
      draft: z.boolean().optional(),
    }),
  )
  .action(
    async ({
      parsedInput: { username, repo, title, body, base, head, draft },
    }) => {
      const { data, error } = await fetchClient.POST(
        "/api/repositories/{username}/{repo}/pulls",
        {
          params: { path: { username, repo } },
          body: { title, body, base, head, draft: draft ?? false },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      redirect(`/${username}/${repo}/pulls/${data.number}`);
    },
  );

export const mergePullRequest = actionClient
  .inputSchema(
    target.extend({
      title: z.string().optional(),
      message: z.string().optional(),
      method: z.enum(mergeMethods),
    }),
  )
  .action(
    async ({
      parsedInput: { username, repo, number, title, message, method },
    }) => {
      const { data, error } = await fetchClient.POST(
        "/api/repositories/{username}/{repo}/pulls/{number}/merge",
        {
          params: { path: { username, repo, number } },
          body: { title, message, method },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      revalidatePath(`/${username}/${repo}/pulls/${number}`);
      return data;
    },
  );

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

/** Marks a draft ready for review, or turns a request back into a draft. */
export const setDraft = actionClient
  .inputSchema(target.extend({ draft: z.boolean() }))
  .action(async ({ parsedInput: { username, repo, number, draft } }) => {
    const { error } = await fetchClient.POST(
      draft
        ? "/api/repositories/{username}/{repo}/pulls/{number}/draft"
        : "/api/repositories/{username}/{repo}/pulls/{number}/ready",
      {
        params: { path: { username, repo, number } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}/pulls/${number}`, "layout");
  });

const lineComment = z.object({
  path: z.string().min(1),
  side: z.enum(["deletions", "additions"]),
  line: z.number().int().min(1),
  startSide: z.enum(["deletions", "additions"]).optional(),
  startLine: z.number().int().min(1).optional(),
  body: z
    .string()
    .trim()
    .min(1, "Write a comment.")
    .max(20000, "Comments are limited to 20000 characters."),
});

const commentBody = z
  .string()
  .trim()
  .min(1, "Write a comment.")
  .max(20000, "Comments are limited to 20000 characters.");

/** Submits the viewer's pending review, if any, with the comments given here. */
export const submitReview = actionClient
  .inputSchema(
    target.extend({
      state: z.enum(["commented", "approved", "changes_requested"]),
      body: z
        .string()
        .max(20000, "Reviews are limited to 20000 characters.")
        .optional(),
      comments: z.array(lineComment).optional(),
    }),
  )
  .action(
    async ({
      parsedInput: { username, repo, number, state, body, comments },
    }) => {
      const { error } = await fetchClient.POST(
        "/api/repositories/{username}/{repo}/pulls/{number}/reviews",
        {
          params: { path: { username, repo, number } },
          body: { state, body, comments },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      revalidatePath(`/${username}/${repo}/pulls/${number}`, "layout");
    },
  );

export const addPendingComment = actionClient
  .inputSchema(target.extend({ comment: lineComment }))
  .action(async ({ parsedInput: { username, repo, number, comment } }) => {
    const { error } = await fetchClient.POST(
      "/api/repositories/{username}/{repo}/pulls/{number}/reviews/pending/comments",
      {
        params: { path: { username, repo, number } },
        body: comment,
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}/pulls/${number}/files`);
  });

export const discardPendingReview = actionClient
  .inputSchema(target)
  .action(async ({ parsedInput: { username, repo, number } }) => {
    const { error } = await fetchClient.DELETE(
      "/api/repositories/{username}/{repo}/pulls/{number}/reviews/pending",
      {
        params: { path: { username, repo, number } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}/pulls/${number}/files`);
  });

export const dismissReview = actionClient
  .inputSchema(
    target.extend({
      reviewId: z.string(),
      message: z
        .string()
        .trim()
        .min(1, "Say why the review is dismissed.")
        .max(1000, "Messages are limited to 1000 characters."),
    }),
  )
  .action(
    async ({ parsedInput: { username, repo, number, reviewId, message } }) => {
      const { error } = await fetchClient.POST(
        "/api/repositories/{username}/{repo}/pulls/{number}/reviews/{reviewId}/dismiss",
        {
          params: { path: { username, repo, number, reviewId } },
          body: { message },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      revalidatePath(`/${username}/${repo}/pulls/${number}`, "layout");
    },
  );

export const applySuggestion = actionClient
  .inputSchema(target.extend({ commentId: z.string() }))
  .action(async ({ parsedInput: { username, repo, number, commentId } }) => {
    const { error } = await fetchClient.POST(
      "/api/repositories/{username}/{repo}/pulls/{number}/comments/{commentId}/apply",
      {
        params: { path: { username, repo, number, commentId } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}/pulls/${number}`, "layout");
  });

export const replyToReviewComment = actionClient
  .inputSchema(target.extend({ commentId: z.string(), body: commentBody }))
  .action(
    async ({ parsedInput: { username, repo, number, commentId, body } }) => {
      const { error } = await fetchClient.POST(
        "/api/repositories/{username}/{repo}/pulls/{number}/comments/{commentId}/replies",
        {
          params: { path: { username, repo, number, commentId } },
          body: { body },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      revalidatePath(`/${username}/${repo}/pulls/${number}`, "layout");
    },
  );

export const updateReviewComment = actionClient
  .inputSchema(target.extend({ commentId: z.string(), body: commentBody }))
  .action(
    async ({ parsedInput: { username, repo, number, commentId, body } }) => {
      const { error } = await fetchClient.PATCH(
        "/api/repositories/{username}/{repo}/pulls/{number}/comments/{commentId}",
        {
          params: { path: { username, repo, number, commentId } },
          body: { body },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      revalidatePath(`/${username}/${repo}/pulls/${number}`, "layout");
    },
  );

export const deleteReviewComment = actionClient
  .inputSchema(target.extend({ commentId: z.string() }))
  .action(async ({ parsedInput: { username, repo, number, commentId } }) => {
    const { error } = await fetchClient.DELETE(
      "/api/repositories/{username}/{repo}/pulls/{number}/comments/{commentId}",
      {
        params: { path: { username, repo, number, commentId } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}/pulls/${number}`, "layout");
  });

/** A review's summary is edited like a comment, so its id travels as `commentId`. */
export const updateReviewSummary = actionClient
  .inputSchema(
    target.extend({
      commentId: z.string(),
      body: z.string().max(20000, "Reviews are limited to 20000 characters."),
    }),
  )
  .action(
    async ({ parsedInput: { username, repo, number, commentId, body } }) => {
      const { error } = await fetchClient.PATCH(
        "/api/repositories/{username}/{repo}/pulls/{number}/reviews/{reviewId}",
        {
          params: { path: { username, repo, number, reviewId: commentId } },
          body: { body: body.trim() ? body : null },
          headers: { cookie: (await cookies()).toString() },
        },
      );

      if (error) throw new Error(error.message);

      revalidatePath(`/${username}/${repo}/pulls/${number}`, "layout");
    },
  );

export const updatePullRequest = actionClient
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
    const { error } = await fetchClient.PATCH(
      "/api/repositories/{username}/{repo}/pulls/{number}",
      {
        params: { path: { username, repo, number } },
        body: { title, body },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) throw new Error(error.message);

    revalidatePath(`/${username}/${repo}/pulls/${number}`);
  });
