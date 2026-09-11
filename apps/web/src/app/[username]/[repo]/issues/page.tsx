import { CircleDot, CircleCheck, MessageSquare } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import type { IssueFilter, IssueSort } from "@/components/issues/common";
import { issueFilters, issueSorts } from "@/components/issues/common";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createServerClient } from "@/lib/api/server";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function IssuesPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/issues">) {
  const { username, repo } = await params;
  const query = await searchParams;

  const filter: IssueFilter = issueFilters.includes(query.state as IssueFilter)
    ? (query.state as IssueFilter)
    : "open";
  const sort: IssueSort = issueSorts.includes(query.sort as IssueSort)
    ? (query.sort as IssueSort)
    : "created";
  const direction = query.direction === "asc" ? "asc" : "desc";
  const q = stringParam(query.q);
  const labels = stringParam(query.labels);
  const assignee = stringParam(query.assignee);
  const author = stringParam(query.author);
  const cursor = stringParam(query.cursor);

  const client = await createServerClient();
  const [issues, allLabels] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/issues", {
      params: {
        path: { username, repo },
        query: {
          state: filter,
          limit: PAGE_SIZE,
          cursor,
          q,
          labels,
          assignee,
          author,
          sort,
          direction,
        },
      },
    }),
    client.GET("/api/repositories/{username}/{repo}/labels", {
      params: { path: { username, repo } },
    }),
  ]);

  if (issues.response.status === 404) notFound();
  if (!issues.data) {
    throw new Error(`Failed to list issues of ${username}/${repo}`);
  }

  const base = `/${username}/${repo}/issues`;

  function href(next: Record<string, string | undefined>) {
    const merged: Record<string, string> = {};
    const current: Record<string, string | undefined> = {
      state: filter === "open" ? undefined : filter,
      q,
      labels,
      assignee,
      author,
      sort: sort === "created" ? undefined : sort,
      direction: direction === "desc" ? undefined : direction,
    };
    for (const [key, value] of Object.entries({ ...current, ...next })) {
      if (value !== undefined) merged[key] = value;
    }
    const params = new URLSearchParams(merged);
    const suffix = params.size > 0 ? `?${params}` : "";
    return `${base}${suffix}`;
  }

  const selectedLabels = (labels ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <Link
            href={href({ state: undefined })}
            className={cn(
              buttonVariants({
                variant: filter === "open" ? "secondary" : "ghost",
                size: "sm",
              }),
            )}
          >
            <CircleDot data-icon="inline-start" />
            Open
            <span className="ml-1 tabular-nums">{issues.data.openCount}</span>
          </Link>
          <Link
            href={href({ state: "closed" })}
            className={cn(
              buttonVariants({
                variant: filter === "closed" ? "secondary" : "ghost",
                size: "sm",
              }),
            )}
          >
            <CircleCheck data-icon="inline-start" />
            Closed
            <span className="ml-1 tabular-nums">{issues.data.closedCount}</span>
          </Link>
        </div>

        <Button size="sm" className="ml-auto" asChild>
          <Link href={`${base}/new`}>
            <CircleDot data-icon="inline-start" />
            New issue
          </Link>
        </Button>
      </div>

      <form action={base} className="flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search title and body…"
          autoComplete="off"
          className="min-w-0 flex-1 sm:max-w-xs"
        />
        {filter !== "open" && (
          <input type="hidden" name="state" value={filter} />
        )}
        {assignee && <input type="hidden" name="assignee" value={assignee} />}
        {author && <input type="hidden" name="author" value={author} />}
        {labels && <input type="hidden" name="labels" value={labels} />}
        <Select name="sort" defaultValue={sort}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {issueSorts.map((option) => (
              <SelectItem key={option} value={option}>
                <span className="capitalize">Sort: {option}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
        {(q || labels || assignee || author) && (
          <Link
            href={href({
              q: undefined,
              labels: undefined,
              assignee: undefined,
              author: undefined,
            })}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Clear
          </Link>
        )}
      </form>

      {(allLabels.data?.labels ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedLabels.map((name) => (
            <Link
              key={name}
              href={href({
                labels:
                  selectedLabels.filter((label) => label !== name).join(",") ||
                  undefined,
              })}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              {name} ✕
            </Link>
          ))}
          {(allLabels.data?.labels ?? [])
            .filter((label) => !selectedLabels.includes(label.name))
            .map((label) => (
              <Link
                key={label.id}
                href={href({
                  labels: [...selectedLabels, label.name].join(","),
                })}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: `#${label.color}` }}
                />
                {label.name}
              </Link>
            ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        {issues.data.issues.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {filter === "all"
              ? "This repository has no issues yet."
              : `There are no ${filter} issues.`}
          </p>
        ) : (
          <ul className="divide-y">
            {issues.data.issues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-muted/40"
              >
                {issue.state === "open" ? (
                  <CircleDot className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                ) : (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-red-500" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`${base}/${issue.number}`}
                      className="font-medium hover:underline"
                    >
                      {issue.title}
                    </Link>
                    {issue.labels.map((label) => (
                      <Link key={label.id} href={href({ labels: label.name })}>
                        <Badge
                          className="rounded-full border font-normal"
                          style={{
                            backgroundColor: `#${label.color}22`,
                            borderColor: `#${label.color}66`,
                          }}
                        >
                          <span
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: `#${label.color}` }}
                          />
                          {label.name}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    #{issue.number} opened{" "}
                    <FromNowHoverCard date={issue.createdAt} /> by{" "}
                    {issue.authorUsername}
                    {issue.assignees.length > 0 &&
                      ` · assigned to ${issue.assignees.join(", ")}`}
                  </p>
                </div>

                {issue.commentCount > 0 && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <MessageSquare className="size-3.5" />
                    <span className="tabular-nums">{issue.commentCount}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {issues.data.nextCursor && (
        <div className="flex justify-end">
          <Link
            href={href({ cursor: issues.data.nextCursor })}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Older
          </Link>
        </div>
      )}
    </div>
  );
}
