import { notFound } from "next/navigation";

import {
  createServerClient,
  getServerSession,
  getViewerRole,
} from "@/lib/api/server";
import { API_URL } from "@/lib/env";
import type { PullRequestReview } from "@/types/pull-request";
import { atLeast } from "@ghost/permissions";

import { ReviewDiff } from "./review-diff";

export default async function PullRequestFilesPage({
  params,
}: PageProps<"/[username]/[repo]/pulls/[number]/files">) {
  const { username, repo, number } = await params;

  const [session, client, role] = await Promise.all([
    getServerSession(),
    createServerClient(),
    getViewerRole(username, repo),
  ]);
  const path = { username, repo, number: Number(number) };
  const [summary, pull, timeline, pending] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}/files", {
      params: { path },
    }),
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}", {
      params: { path },
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

  if (summary.response.status === 404) notFound();
  if (!summary.data || !pull.data) {
    throw new Error(`Failed to read the diff of pull request #${number}`);
  }

  const viewer = session?.user.username ?? null;
  return (
    <ReviewDiff
      username={username}
      repo={repo}
      number={Number(number)}
      viewer={viewer}
      canModerate={atLeast(role, "write")}
      from={summary.data.from}
      to={summary.data.to}
      files={summary.data.files}
      patchUrl={`${API_URL}/api/repositories/${username}/${repo}/pulls/${number}/patch`}
      reviews={(timeline.data?.timeline ?? []).filter(
        (item): item is PullRequestReview => item.kind === "review",
      )}
      pending={pending?.data?.review ?? null}
      canReview={viewer !== null && pull.data.state === "open"}
      isAuthor={viewer === pull.data.authorUsername}
      blobUrl={
        pull.data.head.username &&
        `${API_URL}/api/repositories/${pull.data.head.username}/${pull.data.head.slug}/blob`
      }
    />
  );
}
