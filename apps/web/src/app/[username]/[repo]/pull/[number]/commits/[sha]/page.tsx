import Link from "next/link";
import { notFound } from "next/navigation";

import { FileDiffs } from "@/components/diffs/file-diffs";
import { ReviewThread, ThreadCard } from "@/components/pull-requests/review";
import { CommitChecks } from "@/components/repositories/commit-checks";
import { CommitHeader } from "@/components/repositories/commit-header";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import {
  createServerClient,
  getServerSession,
  getViewerRole,
  notFoundIfHidden,
} from "@/lib/api/server";
import { API_URL } from "@/lib/env";
import { placeThreads } from "@/lib/review-placement";
import type { LineAnnotations } from "@/types/diffs";
import type { PullRequestReview } from "@/types/pull-request";
import { atLeast } from "@ghost/permissions";

export default async function PullRequestCommitPage({
  params,
}: PageProps<"/[username]/[repo]/pull/[number]/commits/[sha]">) {
  const { username, repo, number, sha } = await params;

  const [session, client, role] = await Promise.all([
    getServerSession(),
    createServerClient(),
    getViewerRole(username, repo),
  ]);
  const path = { username, repo, number: Number(number) };
  const [pull, commits, timeline, pending] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}", {
      params: { path },
    }),
    // ponytail: first 100 commits only; page through when a request outgrows it.
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}/commits", {
      params: { path, query: { limit: 100 } },
    }),
    client.GET("/api/repositories/{username}/{repo}/issues/{number}/timeline", {
      params: { path },
    }),
    session
      ? client.GET(
          "/api/repositories/{username}/{repo}/pulls/{number}/reviews/pending",
          { params: { path } },
        )
      : null,
  ]);

  notFoundIfHidden(pull.response);
  if (!pull.data || !commits.data) {
    throw new Error(`Failed to read pull request #${number}`);
  }
  const list = commits.data.commits;
  const index = list.findIndex((commit) => commit.sha === sha);
  if (index === -1) notFound();

  // These commits are reachable in the head repository, which is a different repository - and a different object store - whenever the request is a fork. A merge copied them into the base, which is all that is left once the head repository is deleted.
  const { head } = pull.data;
  const owner = head.username ?? username;
  const slug = head.username ? (head.slug ?? repo) : repo;
  const commitPath = { username: owner, slug, sha };
  const [commit, patch] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}/commits/{sha}", {
      params: { path: commitPath },
    }),
    client.GET("/api/repositories/{username}/{slug}/commits/{sha}/patch", {
      params: { path: commitPath },
      parseAs: "text",
    }),
  ]);
  notFoundIfHidden(commit.response);
  if (!commit.data) throw new Error(`Failed to read commit ${sha}`);

  const viewing = {
    username,
    repo,
    number: Number(number),
    viewer: session?.user.username ?? null,
    canModerate: atLeast(role, "write"),
  };
  const reviews = (timeline.data?.timeline ?? []).filter(
    (item): item is PullRequestReview => item.kind === "review",
  );
  const pendingReview = pending?.data?.review ?? null;
  const threads = [
    ...reviews.flatMap((review) => review.comments),
    ...(pendingReview?.comments ?? []),
  ].filter((thread) => thread.commitSha === sha);
  const isPending = (id: string) =>
    pendingReview?.comments.some((thread) => thread.id === id) ?? false;
  const { placed, unplaced } = placeThreads(threads, patch.data ?? "");

  const annotations: Record<string, LineAnnotations> = {};
  for (const thread of placed) {
    annotations[thread.path] ??= [];
    annotations[thread.path].push({
      side: thread.side,
      lineNumber: thread.line,
      metadata: (
        <ReviewThread
          {...viewing}
          thread={thread}
          pending={isPending(thread.id)}
        />
      ),
    });
  }

  const base = `/${username}/${repo}/pull/${number}/commits`;
  const older = list[index + 1];
  const newer = list[index - 1];

  return (
    <div className="flex flex-col gap-4">
      <CommitHeader
        commit={commit.data}
        browseHref={`/${owner}/${slug}/tree/${sha}`}
      >
        {older ? (
          <Link href={`${base}/${older.sha}`} className="hover:underline">
            ← Previous
          </Link>
        ) : null}
        <span>
          Commit {list.length - index} of {list.length}
        </span>
        {newer ? (
          <Link href={`${base}/${newer.sha}`} className="hover:underline">
            Next →
          </Link>
        ) : null}
      </CommitHeader>

      <CommitChecks status={commit.data.status} />

      {unplaced.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">
            Comments on lines outside this commit&apos;s changes
          </h2>
          {unplaced.map((thread) => (
            <ThreadCard
              key={thread.id}
              {...viewing}
              thread={thread}
              headSha={pull.data.headSha}
              pending={isPending(thread.id)}
            />
          ))}
        </section>
      )}

      {commit.data.files.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyDescription>
              This commit has no textual changes.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <FileDiffs
          patchUrl={`${API_URL}/api/repositories/${owner}/${slug}/commits/${sha}/patch`}
          files={commit.data.files}
          annotations={annotations}
        />
      )}
    </div>
  );
}
