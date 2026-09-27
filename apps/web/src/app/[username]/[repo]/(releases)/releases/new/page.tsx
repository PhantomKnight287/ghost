import { atLeast } from "@ghost/permissions";
import { notFound, redirect } from "next/navigation";

import { ReleaseForm } from "@/components/releases/release-form";
import { createServerClient, getServerSession } from "@/lib/api/server";

export default async function NewReleasePage({
  params,
}: PageProps<"/[username]/[repo]/releases/new">) {
  const { username, repo } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  if (!session?.user.username) {
    redirect(
      `/auth/sign-in?redirectTo=${encodeURIComponent(`/${username}/${repo}/releases/new`)}`,
    );
  }

  const [repository, branches] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}", {
      params: { path: { username, slug: repo } },
    }),
    client.GET("/api/repositories/{username}/{slug}/branches", {
      params: { path: { username, slug: repo } },
    }),
  ]);

  if (!repository.data || !atLeast(repository.data.viewerRole, "write")) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">New release</h1>
        <p className="text-sm text-muted-foreground">
          Pick an existing tag, or name a new one to create it.
        </p>
      </div>

      <ReleaseForm
        username={username}
        repo={repo}
        branches={branches.data?.branches ?? []}
        defaultBranch={branches.data?.defaultBranch ?? null}
      />
    </div>
  );
}
