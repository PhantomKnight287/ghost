import { notFound } from "next/navigation";

import { createServerClient, getServerSession } from "@/lib/api/server";

import { MergePanel } from "./page.client";

export default async function PullRequestPage({
  params,
}: PageProps<"/[username]/[repo]/pulls/[number]">) {
  const { username, repo, number } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  const pull = await client.GET(
    "/api/repositories/{username}/{repo}/pulls/{number}",
    { params: { path: { username, repo, number: Number(number) } } },
  );

  if (pull.response.status === 404) notFound();
  if (!pull.data) throw new Error(`Failed to load pull request #${number}`);

  const viewer = session?.user.username;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-medium">
          {pull.data.authorUsername}
        </div>
        <div className="px-4 py-3 text-sm">
          {pull.data.body ? (
            <pre className="whitespace-pre-wrap font-sans">
              {pull.data.body}
            </pre>
          ) : (
            <p className="text-muted-foreground">No description provided.</p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        {[
          { label: "Commits", value: pull.data.commitCount },
          { label: "Files changed", value: pull.data.changedFiles },
          { label: "Additions", value: `+${pull.data.additions}` },
          { label: "Deletions", value: `−${pull.data.deletions}` },
        ].map((stat) => (
          <div key={stat.label} className="bg-background px-4 py-3">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="text-sm font-medium tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <MergePanel
        username={username}
        repo={repo}
        number={Number(number)}
        state={pull.data.state}
        mergeable={pull.data.mergeable}
        // only the base repository's owner can write to it
        canMerge={Boolean(viewer) && viewer === username}
        isAuthor={viewer === pull.data.authorUsername}
        mergeCommitSha={pull.data.mergeCommitSha}
      />
    </div>
  );
}
