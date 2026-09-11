import { CircleCheck, CircleDot } from "lucide-react";
import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Badge } from "@/components/ui/badge";
import { createServerClient, getServerSession } from "@/lib/api/server";
import { cn } from "@/lib/utils";

import { EditableField } from "./page.client";

export default async function IssueLayout({
  params,
  children,
}: LayoutProps<"/[username]/[repo]/issues/[number]">) {
  const { username, repo, number } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);
  const issue = await client.GET(
    "/api/repositories/{username}/{repo}/issues/{number}",
    { params: { path: { username, repo, number: Number(number) } } },
  );

  if (issue.response.status === 404) notFound();
  if (!issue.data) {
    throw new Error(`Failed to load issue #${number}`);
  }

  const viewer = session?.user.username;
  // the author, or whoever can write to the repository
  const canEdit =
    Boolean(viewer) &&
    (viewer === issue.data.authorUsername || viewer === username);
  const Icon = issue.data.state === "open" ? CircleDot : CircleCheck;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <EditableField
          username={username}
          repo={repo}
          number={issue.data.number}
          field="title"
          value={issue.data.title}
          canEdit={canEdit}
        >
          <h1 className="text-xl font-semibold">
            {issue.data.title}{" "}
            <span className="font-normal text-muted-foreground">
              #{issue.data.number}
            </span>
          </h1>
        </EditableField>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge
            className={cn(
              "gap-1.5 rounded-full capitalize",
              issue.data.state === "closed" && "bg-red-600 text-white",
              issue.data.state === "open" && "bg-emerald-600 text-white",
            )}
          >
            <Icon className="size-3.5" />
            {issue.data.state}
          </Badge>

          <span>
            {issue.data.authorUsername} opened this issue{" "}
            <FromNowHoverCard date={issue.data.createdAt} />
          </span>

          {issue.data.state === "closed" && issue.data.closedByUsername && (
            <span>
              · closed by {issue.data.closedByUsername}{" "}
              {issue.data.closedAt && (
                <FromNowHoverCard date={issue.data.closedAt} />
              )}
            </span>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
