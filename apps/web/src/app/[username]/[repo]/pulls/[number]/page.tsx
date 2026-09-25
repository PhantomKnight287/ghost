import { notFound } from "next/navigation";

import { CommentBox } from "@/components/issues/comments";
import { Timeline } from "@/components/issues/timeline";
import { Markdown } from "@/components/markdown";
import { createServerClient, getServerSession } from "@/lib/api/server";

import { EditableField, MergePanel } from "./page.client";

export default async function PullRequestPage({
  params,
}: PageProps<"/[username]/[repo]/pulls/[number]">) {
  const { username, repo, number } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  const path = { username, repo, number: Number(number) };
  const [pull, timeline] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}", {
      params: { path },
    }),
    client.GET("/api/repositories/{username}/{repo}/issues/{number}/timeline", {
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
              <Markdown repository={{ username, repo }}>
                {pull.data.body}
              </Markdown>
            ) : (
              <p className="text-muted-foreground">No description provided.</p>
            )}
          </EditableField>
        </div>
      </div>

      <Timeline
        username={username}
        repo={repo}
        number={Number(number)}
        viewer={viewer}
        items={timeline.data?.timeline ?? []}
        noun="pull request"
      />

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
