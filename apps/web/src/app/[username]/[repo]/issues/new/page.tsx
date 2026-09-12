import { notFound, redirect } from "next/navigation";

import { CreateIssueForm } from "@/components/issues/create-issue-form";
import { createServerClient, getServerSession } from "@/lib/api/server";

export default async function NewIssuePage({
  params,
}: PageProps<"/[username]/[repo]/issues/new">) {
  const { username, repo } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  if (!session?.user.username) {
    redirect(
      `/auth/sign-in?redirectTo=${encodeURIComponent(`/${username}/${repo}/issues/new`)}`,
    );
  }

  const [repository, labels] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}", {
      params: { path: { username, slug: repo } },
    }),
    client.GET("/api/repositories/{username}/{repo}/labels", {
      params: { path: { username, repo } },
    }),
  ]);

  if (repository.response.status === 404) notFound();
  if (!repository.data) throw new Error(`Failed to load ${username}/${repo}`);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">New issue</h1>
        <p className="text-sm text-muted-foreground">
          Describe a bug, a task, or an idea for {username}/{repo}.
        </p>
      </div>

      <CreateIssueForm
        username={username}
        repo={repo}
        labels={labels.data?.labels ?? []}
      />
    </div>
  );
}
