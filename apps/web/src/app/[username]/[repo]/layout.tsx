import { notFound } from "next/navigation";

import { RepositoryFrame } from "@/components/repositories/repository-frame";
import { createServerClient, getServerSession } from "@/lib/api/server";

export default async function RepositoryLayout({
  params,
  children,
}: LayoutProps<"/[username]/[repo]">) {
  const { username, repo } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  const repository = await client.GET("/api/repositories/{username}/{slug}", {
    params: { path: { username, slug: repo } },
  });

  if (repository.response.status === 404) notFound();
  if (repository.error || !repository.data) {
    throw new Error(`Failed to load ${username}/${repo}`);
  }

  const [branches, pulls, issues] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}/branches", {
      params: { path: { username, slug: repo } },
    }),
    client.GET("/api/repositories/{username}/{repo}/pulls", {
      params: { path: { username, repo }, query: { state: "open", limit: 1 } },
    }),
    client.GET("/api/repositories/{username}/{repo}/issues", {
      params: { path: { username, repo }, query: { state: "open", limit: 1 } },
    }),
  ]);

  return (
    <RepositoryFrame
      viewer={session?.user.username ?? ""}
      username={username}
      slug={repository.data.slug}
      name={repository.data.name}
      description={repository.data.description}
      visibility={repository.data.visibility}
      defaultBranch={branches.data?.defaultBranch ?? null}
      branches={branches.data?.branches}
      starCount={repository.data.starCount}
      viewerHasStarred={repository.data.viewerHasStarred}
      forkCount={repository.data.forkCount}
      openPullRequestCount={pulls.data?.total}
      openIssueCount={issues.data?.openCount}
      parent={repository.data.parent}
    >
      {children}
    </RepositoryFrame>
  );
}
