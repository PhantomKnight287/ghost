import { notFound } from "next/navigation";

import { ReleaseForm } from "@/components/releases/release-form";
import { createServerClient } from "@/lib/api/server";

export default async function EditReleasePage({
  params,
}: PageProps<"/[username]/[repo]/releases/edit/[...tag]">) {
  const { username, repo, tag } = await params;
  const tagName = tag.map(decodeURIComponent).join("/");

  const client = await createServerClient();
  const release = await client.GET(
    "/api/repositories/{username}/{repo}/releases/tags/{tag}",
    { params: { path: { username, repo, tag: tagName } } },
  );

  if (!release.data?.viewerCanEdit) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Edit release</h1>
        <p className="text-sm text-muted-foreground">
          The tag stays as it is; only the notes change.
        </p>
      </div>

      <ReleaseForm
        username={username}
        repo={repo}
        branches={[]}
        defaultBranch={null}
        release={release.data}
      />
    </div>
  );
}
