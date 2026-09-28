import { atLeast } from "@ghost/permissions";
import { GitBranch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { createServerClient } from "@/lib/api/server";

import { CreateBranchDialog } from "./create-branch-dialog";
import { DeleteBranchButton } from "./delete-branch-button";

export async function generateMetadata({
  params,
}: PageProps<"/[username]/[repo]/branches">): Promise<Metadata> {
  const { username, repo } = await params;
  return { title: `Branches · ${username}/${repo}` };
}

export default async function BranchesPage({
  params,
}: PageProps<"/[username]/[repo]/branches">) {
  const { username, repo } = await params;

  const client = await createServerClient();
  const [repository, branches] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}", {
      params: { path: { username, slug: repo } },
    }),
    client.GET("/api/repositories/{username}/{slug}/branches", {
      params: { path: { username, slug: repo } },
    }),
  ]);

  if (branches.response.status === 404) notFound();
  if (!branches.data) {
    throw new Error(`Failed to list branches of ${username}/${repo}`);
  }
  const { defaultBranch } = branches.data;
  const canWrite = atLeast(repository.data?.viewerRole ?? null, "write");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Branches</h2>
        {canWrite && defaultBranch && (
          <CreateBranchDialog
            username={username}
            repo={repo}
            branches={branches.data.branches}
            defaultBranch={defaultBranch}
          />
        )}
      </div>

      {branches.data.branches.length === 0 ? (
        <div className="rounded-lg border py-16 text-center">
          <p className="font-medium">There aren&apos;t any branches here</p>
          <p className="text-sm text-muted-foreground">
            Push one with <code>git push origin main</code>.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {branches.data.branches.map((branch) => (
            <li
              key={branch}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <GitBranch className="size-4 shrink-0 text-muted-foreground" />
              <Link
                href={`/${username}/${repo}/tree/${encodeURIComponent(branch)}`}
                className="min-w-0 truncate font-medium hover:underline"
              >
                {branch}
              </Link>
              {branch === defaultBranch && (
                <Badge variant="outline">Default</Badge>
              )}
              {canWrite && branch !== defaultBranch && (
                <div className="ml-auto">
                  <DeleteBranchButton
                    username={username}
                    repo={repo}
                    branch={branch}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
