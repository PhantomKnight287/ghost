import { UserLink } from "@/components/users/user-link";
import { DiffsProvider } from "@/components/diffs/diffs-provider";
import { CommentBox } from "@/components/issues/comments";
import { EditableField } from "@/components/issues/editable-field";
import { Timeline } from "@/components/issues/timeline";
import { Markdown } from "@/components/markdown";
import {
  createServerClient,
  getServerSession,
  getViewerRole,
  notFoundIfHidden,
} from "@/lib/api/server";
import { atLeast } from "@ghost/permissions";

import { reviewerRows } from "@/components/pull-requests/common";

import { MergePanel } from "./merge-panel";
import { ReviewerEditor } from "./reviewer-editor";

export default async function PullRequestPage({
  params,
}: PageProps<"/[username]/[repo]/pull/[number]">) {
  const { username, repo, number } = await params;

  const [session, client, role] = await Promise.all([
    getServerSession(),
    createServerClient(),
    getViewerRole(username, repo),
  ]);

  const path = { username, repo, number: Number(number) };
  const [pull, timeline, requested] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}", {
      params: { path },
    }),
    client.GET("/api/repositories/{username}/{repo}/issues/{number}/timeline", {
      params: { path },
    }),
    client.GET(
      "/api/repositories/{username}/{repo}/pulls/{number}/requested-reviewers",
      { params: { path } },
    ),
  ]);

  notFoundIfHidden(pull.response);
  if (!pull.data) throw new Error(`Failed to load pull request #${number}`);

  const viewer = session?.user.username;
  // Server-computed: the author, or whoever can write to the base repository.
  const canEdit = pull.data.viewerCanEdit;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-w-0 flex-col gap-4">
        <EditableField
          username={username}
          repo={repo}
          number={Number(number)}
          noun="pull request"
          field="body"
          value={pull.data.body ?? ""}
          canEdit={canEdit}
          header={
            <>
              <UserLink
                username={pull.data.authorUsername}
                image={pull.data.authorImage}
                avatar="sm"
              />
              commented
            </>
          }
        >
          {pull.data.body ? (
            <Markdown repository={{ username, repo }}>
              {pull.data.body}
            </Markdown>
          ) : (
            <p className="text-muted-foreground">No description provided.</p>
          )}
        </EditableField>

        <DiffsProvider>
          <Timeline
            username={username}
            repo={repo}
            number={Number(number)}
            viewer={viewer}
            canModerate={atLeast(role, "write")}
            items={timeline.data?.timeline ?? []}
            noun="pull request"
            headSha={pull.data.headSha}
          />
        </DiffsProvider>

        <MergePanel
          username={username}
          repo={repo}
          number={Number(number)}
          state={pull.data.state}
          mergeable={pull.data.mergeable}
          conflicts={pull.data.conflicts}
          canMerge={atLeast(role, "write")}
          isAuthor={viewer === pull.data.authorUsername}
          mergeCommitSha={pull.data.mergeCommitSha}
          squash={pull.data.squash}
          draft={pull.data.draft}
          reviewers={pull.data.reviewers}
          pullRefsBlocked={pull.data.pullRefsBlocked}
          checks={pull.data.checks}
          baseRef={pull.data.base.ref}
          headRef={pull.data.head.ref}
        />

        <CommentBox
          username={username}
          repo={repo}
          number={Number(number)}
          signedIn={Boolean(viewer)}
        />
      </div>

      <aside className="flex flex-col gap-4">
        <ReviewerEditor
          username={username}
          repo={repo}
          number={Number(number)}
          author={pull.data.authorUsername}
          rows={reviewerRows({
            requested: requested.data?.users ?? [],
            verdicts: pull.data.reviewers,
            timeline: timeline.data?.timeline ?? [],
            author: pull.data.authorUsername,
          })}
          teams={requested.data?.teams ?? []}
          canEdit={atLeast(role, "triage")}
        />
      </aside>
    </div>
  );
}
