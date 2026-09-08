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

export const forkRepositorySchema = createRepositorySchema;

export type ForkRepositoryInput = CreateRepositoryInput;
