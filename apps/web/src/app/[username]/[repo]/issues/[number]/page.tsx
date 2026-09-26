import { notFound } from "next/navigation";

import { CommentBox } from "@/components/issues/comments";
import { Timeline } from "@/components/issues/timeline";
import { Markdown } from "@/components/markdown";
import {
  createServerClient,
  getServerSession,
  getViewerRole,
} from "@/lib/api/server";
import { atLeast } from "@ghost/permissions";

import { AssigneeEditor, EditableField, LabelEditor } from "./page.client";

export default async function IssuePage({
  params,
}: PageProps<"/[username]/[repo]/issues/[number]">) {
  const { username, repo, number } = await params;

  const [session, client, role] = await Promise.all([
    getServerSession(),
    createServerClient(),
    getViewerRole(username, repo),
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
  // Server-computed: the author, or whoever can write to the repository.
  const canEdit = issue.data.viewerCanEdit;
  // Triage closes, labels and assigns other people's issues without being able to edit them.
  const canTriage = canEdit || atLeast(role, "triage");

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
                <Markdown repository={{ username, repo }}>
                  {issue.data.body}
                </Markdown>
              ) : (
                <p className="text-muted-foreground">
                  No description provided.
                </p>
              )}
            </EditableField>
          </div>
        </div>

        <Timeline
          username={username}
          repo={repo}
          number={Number(number)}
          viewer={viewer}
          canModerate={atLeast(role, "write")}
          items={timeline.data?.timeline ?? []}
          noun="issue"
        />

        <CommentBox
          username={username}
          repo={repo}
          number={Number(number)}
          signedIn={Boolean(viewer)}
          state={issue.data.state}
          canChangeState={canTriage}
        />
      </div>

      <aside className="flex flex-col gap-4 lg:pt-0">
        <LabelEditor
          username={username}
          repo={repo}
          number={Number(number)}
          attached={issue.data.labels}
          available={labels.data?.labels ?? []}
          canEdit={canTriage}
          canManage={atLeast(role, "write")}
        />
        <AssigneeEditor
          username={username}
          repo={repo}
          number={Number(number)}
          assignees={issue.data.assignees}
          canEdit={canTriage}
        />
      </aside>
    </div>
  );
}
