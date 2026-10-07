import { CreateIssueForm } from "./create-issue-form";
import {
  createServerClient,
  requireViewer,
  notFoundIfHidden,
} from "@/lib/api/server";

export default async function NewIssuePage({
  params,
}: PageProps<"/[username]/[repo]/issues/new">) {
  const { username, repo } = await params;

  const [viewer, client] = await Promise.all([
    requireViewer(`/${username}/${repo}/issues/new`),
    createServerClient(),
  ]);

  const [repository, labels] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}", {
      params: { path: { username, slug: repo } },
    }),
    client.GET("/api/repositories/{username}/{repo}/labels", {
      params: { path: { username, repo } },
    }),
  ]);

  notFoundIfHidden(repository.response);
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
        viewer={viewer}
      />
    </div>
  );
}
