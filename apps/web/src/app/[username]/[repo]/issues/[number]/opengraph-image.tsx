import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { ogCard, plural } from "@/lib/og";

export { size, contentType } from "@/lib/og";
export const alt = "Issue";

export default async function Image({
  params,
}: {
  params: Promise<{ username: string; repo: string; number: string }>;
}) {
  const { username, repo, number } = await params;

  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{repo}/issues/{number}",
    { params: { path: { username, repo, number: Number(number) } } },
  );

  if (!data) notFound();

  const open = data.state === "open";

  return ogCard({
    eyebrow: `${username}/${repo} · issue #${data.number}`,
    icon: open ? "circleDot" : "circleCheck",
    badge: { label: data.state, color: open ? "#7dd3a0" : "#b9a6f7" },
    title: data.title,
    description: data.body,
    stats: [
      { icon: "user", label: data.authorUsername },
      { icon: "messageSquare", label: plural(data.commentCount, "comment") },
      ...(data.labels.length
        ? [{ icon: "bookMarked" as const, label: plural(data.labels.length, "label") }]
        : []),
    ],
  });
}
