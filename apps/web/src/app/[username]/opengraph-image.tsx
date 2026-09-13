import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { ogCard, plural } from "@/lib/og";

export { size, contentType } from "@/lib/og";
export const alt = "Profile";

export default async function Image({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const client = await createServerClient();
  const { data } = await client.GET("/api/users/{username}", {
    params: { path: { username } },
  });

  // No user, no card: an unknown profile should not get a social preview.
  if (!data) notFound();

  return ogCard({
    eyebrow: "profile",
    icon: "user",
    avatar: data.image,
    title: data.name || data.username,
    description: `@${data.username}`,
    stats: [
      { icon: "folder", label: plural(data.repositoryCount, "repository", "repositories") },
      { icon: "star", label: plural(data.starCount, "star") },
      {
        icon: "clock",
        label: `joined ${new Date(data.joinedAt).getFullYear()}`,
      },
    ],
  });
}
