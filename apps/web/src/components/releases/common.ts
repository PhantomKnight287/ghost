import { z } from "zod";

export const releaseSchema = z.object({
  tagName: z
    .string()
    .trim()
    .min(1, "Enter a tag.")
    .max(250, "Tags are limited to 250 characters."),
  target: z.string().optional(),
  name: z.string().trim().max(200, "Titles are limited to 200 characters."),
  body: z.string().max(100000, "Notes are limited to 100000 characters."),
  isPrerelease: z.boolean(),
});

export type ReleaseInput = z.infer<typeof releaseSchema>;

/** Where a release, or its edit form, lives. Tags may contain `/`, so each segment is encoded on its own. */
export function releasePath(
  username: string,
  repo: string,
  tagName: string,
  view: "tag" | "edit" = "tag",
) {
  return `/${username}/${repo}/releases/${view}/${tagName.split("/").map(encodeURIComponent).join("/")}`;
}
