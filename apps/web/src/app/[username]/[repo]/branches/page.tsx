import { atLeast } from "@ghost/permissions";
import type { Metadata } from "next";

import { createServerClient, notFoundIfHidden } from "@/lib/api/server";

import { BranchList } from "./branch-list";
import { CreateBranchDialog } from "./create-branch-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

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

  notFoundIfHidden(branches.response);
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
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>There aren&apos;t any branches here</EmptyTitle>
            <EmptyDescription>
              Push one with <code>git push origin main</code>.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <BranchList
          username={username}
          repo={repo}
          branches={branches.data.branches}
          defaultBranch={defaultBranch}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}
