import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Markdown } from "@/components/markdown";
import { createServerClient, getServerSession } from "@/lib/api/server";

import { CommentBox, EditableField, MergePanel } from "./page.client";

export default async function PullRequestPage({
  params,
}: PageProps<"/[username]/[repo]/pulls/[number]">) {
  const { username, repo, number } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  const path = { username, repo, number: Number(number) };
  const [pull, comments] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}", {
      params: { path },
    }),
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}/comments", {
      params: { path },
    }),
  ]);

  if (pull.response.status === 404) notFound();
  if (!pull.data) throw new Error(`Failed to load pull request #${number}`);

  const viewer = session?.user.username;
  const canEdit =
    Boolean(viewer) &&
    (viewer === pull.data.authorUsername || viewer === username);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-medium">
          {pull.data.authorUsername}
        </div>
        <div className="px-4 py-3 text-sm">
          <EditableField
            username={username}
            repo={repo}
            number={Number(number)}
            field="body"
            value={pull.data.body ?? ""}
            canEdit={canEdit}
          >
            {pull.data.body ? (
              <Markdown>{pull.data.body}</Markdown>
            ) : (
              <p className="text-muted-foreground">No description provided.</p>
            )}
          </EditableField>
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

      {(comments.data?.comments ?? []).map((comment) => (
        <div key={comment.id} className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {comment.authorUsername}
            </span>
            commented <FromNowHoverCard date={comment.createdAt} />
          </div>
          <div className="px-4 py-3">
            <Markdown>{comment.body}</Markdown>
          </div>
        </div>
      ))}

      <CommentBox
        username={username}
        repo={repo}
        number={Number(number)}
        signedIn={Boolean(viewer)}
      />

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
