"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionClient } from "@/lib/action-client";
import { z } from "zod";

import { callApi } from "@/lib/api/server";
import { collaboratorRoles } from "@/lib/repository-role";

import {
  createBranchSchema,
  createRepositorySchema,
  forkRepositorySchema,
  importRepositorySchema,
  updateRepositorySchema,
} from "./common";

export const createRepository = actionClient
  .inputSchema(
    createRepositorySchema.extend({ organization: z.string().optional() }),
  )
  .action(
    async ({
      parsedInput: { owner, name, description, visibility, organization },
    }) => {
      const data = await callApi((client) =>
        client.POST("/api/repositories", {
          body: { name, description, visibility, organization },
        }),
      );

      redirect(`/${owner}/${data.slug}`);
    },
  );

export const importRepository = actionClient
  .inputSchema(
    importRepositorySchema.extend({ organization: z.string().optional() }),
  )
  .action(
    async ({
      parsedInput: {
        owner,
        source,
        name,
        description,
        visibility,
        organization,
      },
    }) => {
      const data = await callApi((client) =>
        client.POST("/api/imports", {
          body: { source, name, description, visibility, organization },
        }),
      );

      redirect(`/${owner}/${data.slug}`);
    },
  );

export const forkRepository = actionClient
  .inputSchema(
    forkRepositorySchema.extend({
      parentUsername: z.string(),
      parentSlug: z.string(),
      organization: z.string().optional(),
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
        organization,
      },
    }) => {
      const data = await callApi((client) =>
        client.POST("/api/repositories/{username}/{slug}/fork", {
          params: {
            path: { username: parentUsername, slug: parentSlug },
          },
          body: { name, description, visibility, organization },
        }),
      );

      redirect(`/${data.username}/${data.slug}`);
    },
  );

const repositoryPath = z.object({ username: z.string(), slug: z.string() });

export const updateRepository = actionClient
  .inputSchema(updateRepositorySchema.extend(repositoryPath.shape))
  .action(async ({ parsedInput: { username, slug, ...changes } }) => {
    const data = await callApi((client) =>
      client.PATCH("/api/repositories/{username}/{slug}", {
        params: { path: { username, slug } },
        body: changes,
      }),
    );

    return { slug: data.slug };
  });

export const deleteRepository = actionClient
  .inputSchema(repositoryPath)
  .action(async ({ parsedInput: { username, slug } }) => {
    await callApi((client) =>
      client.DELETE("/api/repositories/{username}/{slug}", {
        params: { path: { username, slug } },
      }),
    );

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
    await callApi((client) =>
      client.PUT(
        "/api/repositories/{username}/{repo}/collaborators/{collaborator}",
        {
          params: { path: { username, repo: slug, collaborator } },
          body: { role },
        },
      ),
    );
  });

export const removeCollaborator = actionClient
  .inputSchema(repositoryPath.extend({ collaborator: z.string() }))
  .action(async ({ parsedInput: { username, slug, collaborator } }) => {
    await callApi((client) =>
      client.DELETE(
        "/api/repositories/{username}/{repo}/collaborators/{collaborator}",
        {
          params: { path: { username, repo: slug, collaborator } },
        },
      ),
    );
  });

export const setTeamRole = actionClient
  .inputSchema(
    repositoryPath.extend({
      teamId: z.string(),
      role: z.enum(collaboratorRoles),
    }),
  )
  .action(async ({ parsedInput: { username, slug, teamId, role } }) => {
    await callApi((client) =>
      client.PUT("/api/repositories/{username}/{repo}/teams/{teamId}", {
        params: { path: { username, repo: slug, teamId } },
        body: { role },
      }),
    );
  });

export const removeTeamAccess = actionClient
  .inputSchema(repositoryPath.extend({ teamId: z.string() }))
  .action(async ({ parsedInput: { username, slug, teamId } }) => {
    await callApi((client) =>
      client.DELETE("/api/repositories/{username}/{repo}/teams/{teamId}", {
        params: { path: { username, repo: slug, teamId } },
      }),
    );
  });

export const transferRepository = actionClient
  .inputSchema(repositoryPath.extend({ owner: z.string() }))
  .action(async ({ parsedInput: { username, slug, owner } }) => {
    const data = await callApi((client) =>
      client.POST("/api/repositories/{username}/{slug}/transfer", {
        params: { path: { username, slug } },
        body: { owner },
      }),
    );

    // A transfer someone else has to accept leaves the repository where it is.
    if (data.pending) return { pending: true, owner };
    redirect(`/${data.username}/${data.slug}/settings`);
  });

export const createBranch = actionClient
  .inputSchema(createBranchSchema.extend(repositoryPath.shape))
  .action(async ({ parsedInput: { username, slug, name, from } }) => {
    await callApi((client) =>
      client.POST("/api/repositories/{username}/{repo}/branches", {
        params: { path: { username, repo: slug } },
        body: { name, from: from || undefined },
      }),
    );

    revalidatePath(`/${username}/${slug}`, "layout");
  });

export const deleteBranch = actionClient
  .inputSchema(repositoryPath.extend({ branch: z.string() }))
  .action(async ({ parsedInput: { username, slug, branch } }) => {
    await callApi((client) =>
      client.DELETE("/api/repositories/{username}/{repo}/branches/{branch}", {
        params: { path: { username, repo: slug, branch } },
      }),
    );

    revalidatePath(`/${username}/${slug}`, "layout");
  });
