import { GitCommitHorizontal, GitPullRequest, CircleDot } from "lucide-react";
import Link from "next/link";

import { FromNowHoverCard } from "@/components/from-now-card";
import { CommentItem } from "@/components/issues/comments";
import { eventDescription } from "@/components/issues/common";
import { Markdown } from "@/components/markdown";
import type { IssueTimelineItem } from "@/types/issue";

/** Comments, events and mentions from elsewhere, as one thread. Issues and pull requests share it because a pull request is an issue. */
export function Timeline({
  username,
  repo,
  number,
  viewer,
  items,
  noun,
}: {
  username: string;
  repo: string;
  number: number;
  viewer?: string | null;
  items: IssueTimelineItem[];
  noun: "issue" | "pull request";
}) {
  return items.map((item) => {
    if (item.kind === "comment") {
      return (
        <div key={item.id} className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {item.authorUsername}
            </span>
            commented <FromNowHoverCard date={item.createdAt} />
          </div>
          <CommentItem
            username={username}
            repo={repo}
            number={number}
            commentId={item.id}
            authorUsername={item.authorUsername}
            body={item.body}
            viewer={viewer}
            canModerate={viewer === username}
          >
            <Markdown repository={{ username, repo }}>{item.body}</Markdown>
          </CommentItem>
        </div>
      );
    }

    if (item.kind === "event") {
      const { event } = item;
      return (
        <p key={item.id} className="px-4 text-xs text-muted-foreground">
          {eventDescription(event, noun)}
          {event.sourceRepository && event.sourceNumber !== null && (
            <>
              {" in "}
              <Link
                href={`/${event.sourceRepository}/pulls/${event.sourceNumber}`}
                className="text-foreground hover:underline"
              >
                {event.sourceRepository === `${username}/${repo}`
                  ? `#${event.sourceNumber}`
                  : `${event.sourceRepository}#${event.sourceNumber}`}
              </Link>
            </>
          )}
          {!event.sourceRepository && event.commitSha && (
            <>
              {" in "}
              <code className="font-mono text-foreground">
                {event.commitSha.slice(0, 7)}
              </code>
            </>
          )}{" "}
          · <FromNowHoverCard date={event.createdAt} />
        </p>
      );
    }

    const base = `/${item.repository.username}/${item.repository.slug}`;
    const elsewhere = base !== `/${username}/${repo}`;
    return (
      <p
        key={item.id}
        className="flex flex-wrap items-center gap-1 px-4 text-xs text-muted-foreground"
      >
        {item.source ? (
          item.source.isPullRequest ? (
            <GitPullRequest className="size-3.5" />
          ) : (
            <CircleDot className="size-3.5" />
          )
        ) : (
          <GitCommitHorizontal className="size-3.5" />
        )}
        {item.actorUsername || "Someone"} mentioned this in
        {item.source ? (
          <Link
            href={`${base}/${item.source.isPullRequest ? "pulls" : "issues"}/${item.source.number}`}
            className="text-foreground hover:underline"
          >
            {item.source.title}{" "}
            <span className="text-muted-foreground">
              {elsewhere &&
                `${item.repository.username}/${item.repository.slug}`}
              #{item.source.number}
            </span>
          </Link>
        ) : (
          item.commitSha && (
            <Link
              href={`${base}/commit/${item.commitSha}`}
              className="font-mono text-foreground hover:underline"
            >
              {elsewhere &&
                `${item.repository.username}/${item.repository.slug}@`}
              {item.commitSha.slice(0, 7)}
            </Link>
          )
        )}
        · <FromNowHoverCard date={item.createdAt} />
      </p>
    );
  });
}
