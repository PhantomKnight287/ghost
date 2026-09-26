"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { fetchClient } from "@/lib/fetch-client";
import { collaboratorRoles } from "@/lib/repository-role";

import {
  createRepositorySchema,
  forkRepositorySchema,
  updateRepositorySchema,
} from "./common";

const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});

export const createRepository = actionClient
  .inputSchema(createRepositorySchema)
  .action(async ({ parsedInput: { owner, name, description, visibility } }) => {
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

const repositoryPath = z.object({ username: z.string(), slug: z.string() });

export const updateRepository = actionClient
  .inputSchema(updateRepositorySchema.extend(repositoryPath.shape))
  .action(async ({ parsedInput: { username, slug, ...changes } }) => {
    const { data, error } = await fetchClient.PATCH(
      "/api/repositories/{username}/{slug}",
      {
        params: { path: { username, slug } },
        body: changes,
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    redirect(`/${username}/${data.slug}/settings`);
  });

export const deleteRepository = actionClient
  .inputSchema(repositoryPath)
  .action(async ({ parsedInput: { username, slug } }) => {
    const { error } = await fetchClient.DELETE(
      "/api/repositories/{username}/{slug}",
      {
        params: { path: { username, slug } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    redirect(`/${username}`);
  });

export const inviteCollaborator = actionClient
  .inputSchema(
    repositoryPath.extend({
      collaborator: z.string().trim().min(1, "Enter a username."),
      role: z.enum(collaboratorRoles),
    }),
  )
  .action(async ({ parsedInput: { username, slug, collaborator, role } }) => {
    const { error } = await fetchClient.PUT(
      "/api/repositories/{username}/{repo}/collaborators/{collaborator}",
      {
        params: { path: { username, repo: slug, collaborator } },
        body: { role },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) {
      throw new Error(error.message);
    }
  });

export const removeCollaborator = actionClient
  .inputSchema(repositoryPath.extend({ collaborator: z.string() }))
  .action(async ({ parsedInput: { username, slug, collaborator } }) => {
    const { error } = await fetchClient.DELETE(
      "/api/repositories/{username}/{repo}/collaborators/{collaborator}",
      {
        params: { path: { username, repo: slug, collaborator } },
        headers: { cookie: (await cookies()).toString() },
      },
    );

    if (error) {
      throw new Error(error.message);
    }
  });
