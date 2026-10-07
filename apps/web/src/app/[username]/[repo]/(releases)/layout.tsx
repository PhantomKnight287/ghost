import { atLeast } from "@ghost/permissions";

import { ReleasesNav } from "./releases-nav";
import { getViewerRole } from "@/lib/api/server";

/** Keeps the releases and tags tabs mounted while switching between them. */
export default async function ReleasesLayout({
  params,
  children,
}: LayoutProps<"/[username]/[repo]">) {
  const { username, repo } = await params;

  const role = await getViewerRole(username, repo);

  return (
    <div className="flex flex-col gap-4">
      <ReleasesNav
        username={username}
        repo={repo}
        canWrite={atLeast(role, "write")}
      />
      {children}
    </div>
  );
}
