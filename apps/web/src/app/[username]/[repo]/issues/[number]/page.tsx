import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import { eventDescription } from "@/components/issues/common";
import { Markdown } from "@/components/markdown";
import { createServerClient, getServerSession } from "@/lib/api/server";

import {
  AssigneeEditor,
  CommentBox,
  CommentItem,
  EditableField,
  IssueStatePanel,
  LabelEditor,
} from "./page.client";

export default async function IssuePage({
  params,
}: PageProps<"/[username]/[repo]/issues/[number]">) {
  const { username, repo, number } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  const path = { username, repo, number: Number(number) };
  const [issue, timeline, labels] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/issues/{number}", {
      params: { path },
    }),
    client.GET("/api/repositories/{username}/{repo}/issues/{number}/timeline", {
      params: { path },
    }),
    client.GET("/api/repositories/{username}/{repo}/labels", {
      params: { path: { username, repo } },
    }),
  ]);

  if (issue.response.status === 404) notFound();
  if (!issue.data) throw new Error(`Failed to load issue #${number}`);
  if (timeline.response.status === 404) notFound();

  const viewer = session?.user.username;
  // the author, or whoever can write to the repository
  const canEdit =
    Boolean(viewer) &&
    (viewer === issue.data.authorUsername || viewer === username);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-medium">
            {issue.data.authorUsername}
          </div>
          <div className="px-4 py-3 text-sm">
            <EditableField
              username={username}
              repo={repo}
              number={Number(number)}
              field="body"
              value={issue.data.body ?? ""}
              canEdit={canEdit}
            >
              {issue.data.body ? (
                <Markdown>{issue.data.body}</Markdown>
              ) : (
                <p className="text-muted-foreground">
                  No description provided.
                </p>
              )}
            </EditableField>
          </div>
        </div>

        {(timeline.data?.timeline ?? []).map((item) =>
          item.kind === "comment" ? (
            <div key={item.id} className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {item.authorUsername}
                </span>
                commented <FromNowHoverCard date={item.createdAt} />
              </div>
              <CommentItem
                username={username}
                repo={repo}
                number={Number(number)}
                commentId={item.id}
                authorUsername={item.authorUsername}
                body={item.body}
                viewer={viewer}
                canModerate={viewer === username}
              >
                <Markdown>{item.body}</Markdown>
              </CommentItem>
            </div>
          ) : (
            <p
              key={item.event.id}
              className="px-4 text-xs text-muted-foreground"
            >
              {eventDescription(item.event)} ·{" "}
              <FromNowHoverCard date={item.event.createdAt} />
            </p>
          ),
        )}

        <CommentBox
          username={username}
          repo={repo}
          number={Number(number)}
          signedIn={Boolean(viewer)}
        />

        <IssueStatePanel
          username={username}
          repo={repo}
          number={Number(number)}
          state={issue.data.state}
          canChangeState={canEdit}
        />
      </div>

      <aside className="flex flex-col gap-4 lg:pt-0">
        <LabelEditor
          username={username}
          repo={repo}
          number={Number(number)}
          attached={issue.data.labels}
          available={labels.data?.labels ?? []}
          canEdit={canEdit}
        />
        <AssigneeEditor
          username={username}
          repo={repo}
          number={Number(number)}
          assignees={issue.data.assignees}
          canEdit={canEdit}
        />
      </aside>
    </div>
  );
}
