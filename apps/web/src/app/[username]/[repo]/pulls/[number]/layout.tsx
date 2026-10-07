import type { Metadata } from "next";
import { Suspense } from "react";

import { UserLink } from "@/components/users/user-link";
import { FromNowHoverCard } from "@/components/from-now-card";
import { EditableField } from "@/components/issues/editable-field";
import { CheckoutPopover } from "./checkout-popover";
import { branchLabel } from "@/components/pull-requests/common";
import {
  ThreadSubscription,
  ThreadSubscriptionSkeleton,
} from "@/components/notifications/thread-subscription";
import { Badge } from "@/components/ui/badge";
import {
  createServerClient,
  getServerSession,
  getViewerRole,
  notFoundIfHidden,
} from "@/lib/api/server";
import { atLeast } from "@ghost/permissions";
import { cn } from "@/lib/utils";

import { PullRequestNav } from "./pull-request-nav";
import { threadStateStyle } from "@/components/thread-state";

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

  const [session, client, role] = await Promise.all([
    getServerSession(),
    createServerClient(),
    getViewerRole(username, repo),
  ]);
  const pull = await client.GET(
    "/api/repositories/{username}/{repo}/pulls/{number}",
    { params: { path: { username, repo, number: Number(number) } } },
  );

  notFoundIfHidden(pull.response);
  if (!pull.data) {
    throw new Error(`Failed to load pull request #${number}`);
  }

  const { state, base, head } = pull.data;
  const viewer = session?.user.username;
  // the author, or whoever can write to the base repository
  const canEdit =
    Boolean(viewer) &&
    (viewer === pull.data.authorUsername || atLeast(role, "write"));
  const { Icon, badge } = threadStateStyle(true, state);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <EditableField
          username={username}
          repo={repo}
          number={pull.data.number}
          noun="pull request"
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

        <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-start">
          {/* the text wraps beside the buttons rather than pushing them onto a line of their own */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Badge className={cn("gap-1.5 rounded-full capitalize", badge)}>
              <Icon className="size-3.5" />
              {state}
            </Badge>
            {pull.data.draft && state === "open" && (
              <Badge variant="outline" className="rounded-full">
                Draft
              </Badge>
            )}

            <span>
              <UserLink
                username={pull.data.authorUsername}
                image={pull.data.authorImage}
                avatar="xs"
                className="align-middle"
              />{" "}
              wants to merge {pull.data.commitCount} commit
              {pull.data.commitCount === 1 ? "" : "s"} into{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs break-all">
                {branchLabel(base, head)}
              </code>{" "}
              from{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs break-all">
                {branchLabel(head, base)}
              </code>
            </span>

            <span>
              · opened <FromNowHoverCard date={pull.data.createdAt} />
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <CheckoutPopover
              username={username}
              repo={repo}
              number={pull.data.number}
            />
            <Suspense fallback={<ThreadSubscriptionSkeleton />}>
              <ThreadSubscription
                username={username}
                repo={repo}
                number={Number(number)}
              />
            </Suspense>
          </div>
        </div>
      </div>

      {head.username === null && state === "closed" && (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          The repository this pull request came from was deleted, and its
          changes with it.
        </p>
      )}

      <PullRequestNav
        base={`/${username}/${repo}/pulls/${pull.data.number}`}
        commitCount={pull.data.commitCount}
        changedFiles={pull.data.changedFiles}
        additions={pull.data.additions}
        deletions={pull.data.deletions}
      />

      {children}
    </div>
  );
}
