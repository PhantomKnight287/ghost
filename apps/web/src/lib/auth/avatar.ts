import type { AvatarConfig } from "@better-auth-ui/core";

import { API_URL } from "@/lib/env";

/**
 * Avatar storage backed by the API's S3 bucket.
 *
 * Without this, Better Auth UI falls back to a base64 data URL saved straight
 * into `user.image` - which then rides along in every session payload. The
 * upload returns the URL the API serves the object from, and `updateUser`
 * stores that instead.
 */
export const avatar: Partial<AvatarConfig> = {
  // PNG, not WebP: avatars are drawn into the OG images, and `next/og` cannot
  // decode WebP.
  extension: "png",

  upload: async (file) => {
    const response = await fetch(`${API_URL}/api/users/avatar`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": file.type },
      body: file,
    });

    if (!response.ok) throw new Error(await errorMessage(response));

    const { url } = (await response.json()) as { url: string };
    return url;
  },

  delete: async () => {
    const response = await fetch(`${API_URL}/api/users/avatar`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) throw new Error(await errorMessage(response));
  },
};

async function errorMessage(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;

  return body?.message ?? `Avatar request failed (${response.status})`;
}
