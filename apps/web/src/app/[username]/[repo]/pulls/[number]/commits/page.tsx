import { CommitList } from "@/components/repositories/commit-list";
import { createServerClient, notFoundIfHidden } from "@/lib/api/server";

export default async function PullRequestCommitsPage({
  params,
}: PageProps<"/[username]/[repo]/pulls/[number]/commits">) {
  const { username, repo, number } = await params;

  const client = await createServerClient();
  const path = { username, repo, number: Number(number) };

  const [commits, pull] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}/commits", {
      params: { path },
    }),
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}", {
      params: { path },
    }),
  ]);

  notFoundIfHidden(commits.response);
  if (!commits.data || !pull.data) {
    throw new Error(`Failed to list commits of pull request #${number}`);
  }

  // These commits are reachable in the head repository, which is a different repository - and a different object store - whenever the request is a fork. A merge copied them into the base, which is all that is left once the head repository is deleted.
  const { head } = pull.data;
  const commitBase = head.username
    ? `/${head.username}/${head.slug}`
    : `/${username}/${repo}`;

  return (
    <div className="overflow-hidden rounded-lg border">
      <CommitList
        commits={commits.data.commits}
        commitBase={commitBase}
        empty="This branch adds no commits to the base."
      />
    </div>
  );
}
