import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { ogCard, plural } from "@/lib/og";

export { size, contentType } from "@/lib/og";
export const alt = "Repository";

export default async function Image({
  params,
}: {
  params: Promise<{ username: string; repo: string }>;
}) {
  const { username, repo } = await params;

  const client = await createServerClient();
  const { data } = await client.GET("/api/repositories/{username}/{slug}", {
    params: { path: { username, slug: repo } },
  });

  // A private repository answers 404 to the crawler, so nothing leaks here.
  if (!data) notFound();

  return ogCard({
    eyebrow: `${username}/${data.slug}`,
    icon: "bookMarked",
    title: data.name,
    description: data.description,
    stats: [
      { icon: "star", label: plural(data.starCount, "star") },
      { icon: "gitFork", label: plural(data.forkCount, "fork") },
    ],
  });
}
