import { OwnersBadge } from "@/components/codeowners/owners-badge";
import {
  createServerClient,
  getCodeOwners,
  getServerSession,
  getViewerRole,
  notFoundIfHidden,
} from "@/lib/api/server";
import { API_URL } from "@/lib/env";
import type { PullRequestReview } from "@/types/pull-request";
import { atLeast } from "@ghost/permissions";

import { ReviewDiff } from "./review-diff";

export default async function PullRequestFilesPage({
  params,
}: PageProps<"/[username]/[repo]/pull/[number]/files">) {
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

  notFoundIfHidden(summary.response);
  if (!summary.data || !pull.data) {
    throw new Error(`Failed to read the diff of pull request #${number}`);
  }

  const viewer = session?.user.username ?? null;
  const owners = await getCodeOwners(
    username,
    repo,
    pull.data.base.ref,
    summary.data.files.map((file) => file.path),
  );
  // Owners name teams, so the viewer's own are found by reading each team; one they cannot read is one they are not in.
  const teams = viewer
    ? [...new Set(Object.values(owners).flat())].filter((owner) =>
        owner.includes("/"),
      )
    : [];
  const memberships = await Promise.all(
    teams.map(async (team) => {
      const [slug, name] = team.slice(1).split("/");
      const { data } = await client.GET(
        "/api/organizations/{slug}/teams/{team}",
        { params: { path: { slug, team: name } } },
      );
      return data?.members.some((member) => member.username === viewer)
        ? team
        : null;
    }),
  );
  const mine = new Set(viewer ? [`@${viewer}`, ...memberships] : []);

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
      headers={Object.fromEntries(
        Object.entries(owners).map(([file, logins]) => [
          file,
          <OwnersBadge
            key={file}
            logins={logins}
            mine={logins.some((login) => mine.has(login))}
          />,
        ]),
      )}
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
