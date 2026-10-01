import { z } from "zod";

export const repositoryVisibilities = ["public", "private"] as const;

export const createRepositorySchema = z.object({
  owner: z.string().min(1, "Choose an owner."),
  name: z
    .string()
    .min(1, "Enter a repository name.")
    .max(100, "Repository names are limited to 100 characters.")
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "Use letters, numbers, hyphens, underscores or periods.",
    ),
  description: z
    .string()
    .max(350, "Descriptions are limited to 350 characters.")
    .optional(),
  visibility: z.enum(repositoryVisibilities),
});

export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;

const githubSource = z
  .string()
  .regex(
    /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/,
    "Write the GitHub repository as owner/name.",
  );

export const importRepositorySchema = createRepositorySchema.extend({
  source: githubSource,
});

// The new repository form imports when a source is given and creates an empty repository when it is left blank.
export const newRepositorySchema = createRepositorySchema.extend({
  source: githubSource.or(z.literal("")),
});

export type NewRepositoryInput = z.infer<typeof newRepositorySchema>;

export const forkRepositorySchema = createRepositorySchema;

export type ForkRepositoryInput = CreateRepositoryInput;

// Each settings card saves its own field, so every field is optional.
export const updateRepositorySchema = createRepositorySchema
  .omit({ owner: true })
  .extend({ defaultBranch: z.string() })
  .partial();

export type UpdateRepositoryInput = z.infer<typeof updateRepositorySchema>;

export const createBranchSchema = z.object({
  name: z.string().trim().min(1, "Enter a branch name."),
  from: z.string(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
