import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CreatePullRequestForm } from "@/components/pull-requests/create-pull-request-form";
import { DiffView } from "@/components/pull-requests/diff-view";
import { createServerClient, getServerSession } from "@/lib/api/server";
import { API_URL } from "@/lib/env";

export default async function NewPullRequestPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/pulls/new">) {
  const { username, repo } = await params;
  const selected = await searchParams;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  if (!session?.user.username) {
    redirect(
      `/auth/sign-in?redirectTo=${encodeURIComponent(`/${username}/${repo}/pulls/new`)}`,
    );
  }

  const repository = await client.GET("/api/repositories/{username}/{slug}", {
    params: { path: { username, slug: repo } },
  });

  if (repository.response.status === 404) notFound();
  if (!repository.data) throw new Error(`Failed to load ${username}/${repo}`);

  const viewerForkSlug = repository.data.viewerForkSlug;
  const viewer = session.user.username;

  // Branches of this repository, and of the viewer's fork when they have one -
  // a fork's branch is proposed as `owner:branch`, which is what the API resolves.
  const [branches, forkBranches] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}/branches", {
      params: { path: { username, slug: repo } },
    }),
    viewerForkSlug
      ? client.GET("/api/repositories/{username}/{slug}/branches", {
          params: { path: { username: viewer, slug: viewerForkSlug } },
        })
      : null,
  ]);

  const own = branches.data?.branches ?? [];
  const heads = [
    ...own,
    ...(forkBranches?.data?.branches ?? []).map(
      (branch) => `${viewer}:${branch}`,
    ),
  ];

  const base =
    typeof selected.base === "string" && own.includes(selected.base)
      ? selected.base
      : (branches.data?.defaultBranch ?? own[0] ?? "");
  const head =
    typeof selected.head === "string" && heads.includes(selected.head)
      ? selected.head
      : "";

  const comparison =
    base && head
      ? await client.GET("/api/repositories/{username}/{repo}/pulls/compare", {
          params: { path: { username, repo }, query: { base, head } },
        })
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Open a pull request</h1>
        <p className="text-sm text-muted-foreground">
          Propose the commits on one branch for merging into another.
        </p>
      </div>

      {repository.data.parent && (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Proposing these changes to{" "}
          <Link
            href={`/${repository.data.parent.username}/${repository.data.parent.slug}/pulls/new`}
            className="text-primary hover:underline"
          >
            {repository.data.parent.username}/{repository.data.parent.name}
          </Link>{" "}
          instead? Open the request there, and this fork&apos;s branches will be
          offered as the source.
        </p>
      )}

      <CreatePullRequestForm
        username={username}
        repo={repo}
        bases={own}
        heads={heads}
        defaultBase={base}
        defaultHead={head}
      />

      {comparison?.data && (
        <DiffView
          from={comparison.data.from}
          to={comparison.data.to}
          files={comparison.data.files}
          patchUrl={`${API_URL}/api/repositories/${username}/${repo}/pulls/compare/patch?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`}
        />
      )}

      {comparison?.error && (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {comparison.error.message ?? "Could not compare these branches."}
        </p>
      )}
    </div>
  );
}
