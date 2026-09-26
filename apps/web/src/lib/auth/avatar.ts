import type { AvatarConfig } from "@better-auth-ui/core";

import { API_URL } from "@/lib/env";

/**
 * Avatar storage backed by the API's S3 bucket.
 *
 * Better Auth UI otherwise stores a base64 data URL in `user.image`, which then rides along in every session payload.
 */
export const avatar: Partial<AvatarConfig> = {
  // PNG, not WebP: avatars are drawn into the OG images, and `next/og` cannot decode WebP.
  extension: "png",

  upload: (file) => putImage("/api/users/avatar", file),
  delete: () => deleteImage("/api/users/avatar"),
};

/** Uploads raw image bytes to an API path that stores a picture, and returns the URL it is served from. */
export async function putImage(path: string, file: Blob) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": file.type },
    body: file,
  });

  if (!response.ok) throw new Error(await errorMessage(response));

  const { url } = (await response.json()) as { url: string };
  return url;
}

export async function deleteImage(path: string) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) throw new Error(await errorMessage(response));
}

async function errorMessage(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;

  return body?.message ?? `Avatar request failed (${response.status})`;
}
