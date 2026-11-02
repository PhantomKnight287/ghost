import { atLeast } from "@ghost/permissions";
import { notFound } from "next/navigation";

import { ReleaseForm } from "@/components/releases/release-form";
import { createServerClient, requireViewer } from "@/lib/api/server";

export default async function NewReleasePage({
  params,
}: PageProps<"/[username]/[repo]/releases/new">) {
  const { username, repo } = await params;

  const [, client] = await Promise.all([
    requireViewer(`/${username}/${repo}/releases/new`),
    createServerClient(),
  ]);

  const [repository, branches, tags, storage] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}", {
      params: { path: { username, slug: repo } },
    }),
    client.GET("/api/repositories/{username}/{slug}/branches", {
      params: { path: { username, slug: repo } },
    }),
    // ponytail: the newest 100 tags only; an older one typed by name still resolves to the existing tag on save
    client.GET("/api/repositories/{username}/{slug}/tags", {
      params: { path: { username, slug: repo }, query: { limit: 100 } },
    }),
    client.GET("/api/storage/{owner}", {
      params: { path: { owner: username } },
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
        tags={tags.data?.tags.map((tag) => tag.name) ?? []}
        defaultBranch={branches.data?.defaultBranch ?? null}
        isFork={Boolean(repository.data.parent)}
        storage={storage.data ?? null}
      />
    </div>
  );
}
