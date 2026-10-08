import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { ogCard } from "@/lib/og";

export { size, contentType } from "@/lib/og";
export const alt = "Releases";

export default async function Image({
  params,
}: {
  params: Promise<{ username: string; repo: string }>;
}) {
  const { username, repo } = await params;

  const client = await createServerClient();
  const [{ data }, latest] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}", {
      params: { path: { username, slug: repo } },
    }),
    client.GET("/api/repositories/{username}/{repo}/releases/latest", {
      params: { path: { username, repo } },
    }),
  ]);

  // A private repository answers 404 to the crawler, so nothing leaks here.
  if (!data) notFound();

  return ogCard({
    eyebrow: `${username}/${data.slug}`,
    icon: "tag",
    title: "Releases",
    description: latest.data
      ? `Latest: ${latest.data.name ?? latest.data.tagName}`
      : data.description,
    stats: latest.data
      ? [{ icon: "tag", label: latest.data.tagName }]
      : undefined,
  });
}
