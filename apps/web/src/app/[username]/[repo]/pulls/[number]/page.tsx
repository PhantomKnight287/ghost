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

import { MergePanel } from "./merge-panel";

export default async function PullRequestPage({
  params,
}: PageProps<"/[username]/[repo]/pulls/[number]">) {
  const { username, repo, number } = await params;

  const [session, client, role] = await Promise.all([
    getServerSession(),
    createServerClient(),
    getViewerRole(username, repo),
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

  notFoundIfHidden(pull.response);
  if (!pull.data) throw new Error(`Failed to load pull request #${number}`);

  const viewer = session?.user.username;
  const canEdit =
    Boolean(viewer) &&
    (viewer === pull.data.authorUsername || atLeast(role, "write"));

  return (
    <div className="flex flex-col gap-4">
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
          <Markdown repository={{ username, repo }}>{pull.data.body}</Markdown>
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
        conflicts={pull.data.conflicts}
        canMerge={atLeast(role, "write")}
        isAuthor={viewer === pull.data.authorUsername}
        mergeCommitSha={pull.data.mergeCommitSha}
        squash={pull.data.squash}
        draft={pull.data.draft}
        reviewers={pull.data.reviewers}
        pullRefsBlocked={pull.data.pullRefsBlocked}
      />
    </div>
  );
}
