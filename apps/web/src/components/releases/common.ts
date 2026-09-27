import { z } from "zod";

import { formatBytes } from "@/lib/utils";

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

/** Where a release, its edit form or its downloads live. Tags may contain `/`, so each segment is encoded on its own. */
export function releasePath(
  username: string,
  repo: string,
  tagName: string,
  view: "tag" | "edit" | "download" = "tag",
) {
  return `/${username}/${repo}/releases/${view}/${tagName.split("/").map(encodeURIComponent).join("/")}`;
}

/** Why these files cannot be uploaded, checked before any byte is sent; the API checks again. Null when they fit. */
export function assetProblem(
  files: { name: string; size: number }[],
  existing: { name: string }[],
  storage: {
    usedBytes: number;
    quotaBytes: number | null;
    maxAssetBytes: number;
  } | null,
) {
  const names = new Set(existing.map((asset) => asset.name));
  for (const file of files) {
    if (names.has(file.name)) return `${file.name} is already attached.`;
    names.add(file.name);
    if (storage && file.size > storage.maxAssetBytes) {
      return `${file.name} is over the ${formatBytes(storage.maxAssetBytes)} limit for one file.`;
    }
  }

  if (storage?.quotaBytes != null) {
    const needed = files.reduce((total, file) => total + file.size, 0);
    const free = Math.max(storage.quotaBytes - storage.usedBytes, 0);
    if (needed > free) {
      return `These files need ${formatBytes(needed)}, but only ${formatBytes(free)} of storage is left.`;
    }
  }
  return null;
}
