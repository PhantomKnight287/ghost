import { CommitList } from "@/components/repositories/commit-list";
import { createServerClient, notFoundIfHidden } from "@/lib/api/server";

export default async function PullRequestCommitsPage({
  params,
}: PageProps<"/[username]/[repo]/pull/[number]/commits">) {
  const { username, repo, number } = await params;

  const client = await createServerClient();
  const commits = await client.GET(
    "/api/repositories/{username}/{repo}/pulls/{number}/commits",
    { params: { path: { username, repo, number: Number(number) } } },
  );

  notFoundIfHidden(commits.response);
  if (!commits.data) {
    throw new Error(`Failed to list commits of pull request #${number}`);
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <CommitList
        commits={commits.data.commits}
        commitHref={`/${username}/${repo}/pull/${number}/commits`}
        empty="This branch adds no commits to the base."
      />
    </div>
  );
}
