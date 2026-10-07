import { atLeast } from "@ghost/permissions";

import { ReleasesNav } from "./releases-nav";
import { createServerClient } from "@/lib/api/server";

/** Keeps the releases and tags tabs mounted while switching between them. */
export default async function ReleasesLayout({
  params,
  children,
}: LayoutProps<"/[username]/[repo]">) {
  const { username, repo } = await params;

  const client = await createServerClient();
  const repository = await client.GET("/api/repositories/{username}/{slug}", {
    params: { path: { username, slug: repo } },
  });

  return (
    <div className="flex flex-col gap-4">
      <ReleasesNav
        username={username}
        repo={repo}
        canWrite={atLeast(repository.data?.viewerRole ?? null, "write")}
      />
      {children}
    </div>
  );
}
