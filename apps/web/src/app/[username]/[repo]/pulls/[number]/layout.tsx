import { GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Badge } from "@/components/ui/badge";
import { createServerClient, getServerSession } from "@/lib/api/server";
import { cn } from "@/lib/utils";

import { EditableField, PullRequestNav } from "./page.client";

export async function generateMetadata({
  params,
}: LayoutProps<"/[username]/[repo]/pulls/[number]">): Promise<Metadata> {
  const { username, repo, number } = await params;
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{repo}/pulls/{number}",
    { params: { path: { username, repo, number: Number(number) } } },
  );

  const title = data
    ? `${data.title} · Pull request #${data.number} · ${username}/${repo}`
    : `Pull request #${number} · ${username}/${repo}`;

  return { title, openGraph: { title } };
}

export default async function PullRequestLayout({
  params,
  children,
}: LayoutProps<"/[username]/[repo]/pulls/[number]">) {
  const { username, repo, number } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);
  const pull = await client.GET(
    "/api/repositories/{username}/{repo}/pulls/{number}",
    { params: { path: { username, repo, number: Number(number) } } },
  );

  if (pull.response.status === 404) notFound();
  if (!pull.data) {
    throw new Error(`Failed to load pull request #${number}`);
  }

  const { state, base, head } = pull.data;
  const viewer = session?.user.username;
  // the author, or whoever can write to the base repository
  const canEdit =
    Boolean(viewer) &&
    (viewer === pull.data.authorUsername || viewer === username);
  const Icon =
    state === "merged"
      ? GitMerge
      : state === "closed"
        ? GitPullRequestClosed
        : GitPullRequest;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <EditableField
          username={username}
          repo={repo}
          number={pull.data.number}
          field="title"
          value={pull.data.title}
          canEdit={canEdit}
        >
          <h1 className="text-xl font-semibold">
            {pull.data.title}{" "}
            <span className="font-normal text-muted-foreground">
              #{pull.data.number}
            </span>
          </h1>
        </EditableField>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge
            className={cn(
              "gap-1.5 rounded-full capitalize",
              state === "merged" && "bg-violet-600 text-white",
              state === "closed" && "bg-red-600 text-white",
              state === "open" && "bg-emerald-600 text-white",
            )}
          >
            <Icon className="size-3.5" />
            {state}
          </Badge>

          <span>
            {pull.data.authorUsername} wants to merge {pull.data.commitCount}{" "}
            commit
            {pull.data.commitCount === 1 ? "" : "s"} into{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {base.username === head.username
                ? base.ref
                : `${base.username}:${base.ref}`}
            </code>{" "}
            from{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {base.username === head.username
                ? head.ref
                : `${head.username}:${head.ref}`}
            </code>
          </span>

          <span>
            · opened <FromNowHoverCard date={pull.data.createdAt} />
          </span>
        </div>
      </div>

      <PullRequestNav
        base={`/${username}/${repo}/pulls/${pull.data.number}`}
        commitCount={pull.data.commitCount}
        changedFiles={pull.data.changedFiles}
      />

      {children}
    </div>
  );
}
