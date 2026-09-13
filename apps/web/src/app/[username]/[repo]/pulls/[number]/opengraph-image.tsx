import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { ogCard, plural } from "@/lib/og";

export { size, contentType } from "@/lib/og";
export const alt = "Pull request";

const STATE_COLOR = {
  open: "#7dd3a0",
  closed: "#e8a3a3",
  merged: "#b9a6f7",
} as const;

export default async function Image({
  params,
}: {
  params: Promise<{ username: string; repo: string; number: string }>;
}) {
  const { username, repo, number } = await params;

  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{repo}/pulls/{number}",
    { params: { path: { username, repo, number: Number(number) } } },
  );

  if (!data) notFound();

  return ogCard({
    eyebrow: `${username}/${repo} · pull request #${data.number}`,
    icon: data.state === "merged" ? "gitMerge" : "gitPullRequest",
    badge: { label: data.state, color: STATE_COLOR[data.state] },
    title: data.title,
    description: `${data.head.ref} → ${data.base.ref}`,
    stats: [
      { icon: "user", label: data.authorUsername },
      { icon: "gitCommitHorizontal", label: plural(data.commitCount, "commit") },
      { icon: "fileDiff", label: plural(data.changedFiles, "file") },
    ],
  });
}
