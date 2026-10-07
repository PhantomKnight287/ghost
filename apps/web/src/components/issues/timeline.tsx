import { GitCommitHorizontal, GitPullRequest, CircleDot } from "lucide-react";
import Link from "next/link";

import { FromNowHoverCard } from "@/components/from-now-card";
import { CommentItem } from "@/components/issues/comments";
import { commitRunAt, eventDescription } from "@/components/issues/common";
import { Markdown } from "@/components/markdown";
import { UserLink } from "@/components/users/user-link";
import { ReviewItem } from "@/components/pull-requests/review";
import type { IssueTimelineItem } from "@/types/issue";

/** Comments, events and mentions from elsewhere, as one thread. Issues and pull requests share it because a pull request is an issue. */
export function Timeline({
  username,
  repo,
  number,
  viewer,
  canModerate,
  items,
  noun,
  headSha,
}: {
  username: string;
  repo: string;
  number: number;
  viewer?: string | null;
  /** May edit and delete anyone's comments. */
  canModerate: boolean;
  items: IssueTimelineItem[];
  noun: "issue" | "pull request";
  /** The request's current head, which line comments on another commit are outdated against. */
  headSha?: string;
}) {
  return items.map((item, index) => {
    if (item.kind === "review") {
      return (
        <ReviewItem
          key={item.id}
          username={username}
          repo={repo}
          number={number}
          viewer={viewer}
          canModerate={canModerate}
          review={item}
          headSha={headSha ?? item.commitSha}
        />
      );
    }

    if (item.kind === "comment") {
      return (
        <CommentItem
          key={item.id}
          username={username}
          repo={repo}
          number={number}
          commentId={item.id}
          authorUsername={item.authorUsername}
          body={item.body}
          viewer={viewer}
          canModerate={canModerate}
          header={
            <>
              <UserLink
                username={item.authorUsername}
                image={item.authorImage}
                avatar="sm"
              />
              commented <FromNowHoverCard date={item.createdAt} />
            </>
          }
        >
          <Markdown repository={{ username, repo }}>{item.body}</Markdown>
        </CommentItem>
      );
    }

    if (item.kind === "event" && item.event.type === "committed") {
      const run = commitRunAt(items, index);
      if (!run) return null;
      return (
        <div key={item.id} className="flex flex-col gap-1.5 px-4 text-xs">
          <p className="text-muted-foreground">
            <UserLink
              username={item.event.actorUsername}
              image={item.event.actorImage}
              avatar="xs"
              className="align-middle"
            />{" "}
            added {run.length} {run.length === 1 ? "commit" : "commits"} ·{" "}
            <FromNowHoverCard date={item.event.createdAt} />
          </p>
          <ul className="ml-1.5 flex flex-col gap-1 border-l pl-4">
            {run.map((commit) => (
              <li key={commit.id} className="flex min-w-0 items-center gap-2">
                <GitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-foreground">
                  {commit.commitMessage}
                </span>
                <span className="hidden shrink-0 text-muted-foreground sm:inline">
                  {commit.commitAuthorName}
                </span>
                <Link
                  href={`/${username}/${repo}/commit/${commit.commitSha}`}
                  className="ml-auto shrink-0 font-mono text-muted-foreground hover:text-foreground hover:underline"
                >
                  {commit.commitSha?.slice(0, 7)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    if (item.kind === "event" && item.event.type === "head_force_pushed") {
      const { event } = item;
      return (
        <p key={item.id} className="px-4 text-xs text-muted-foreground">
          <UserLink
            username={event.actorUsername}
            image={event.actorImage}
            avatar="xs"
            className="align-middle"
          />{" "}
          force-pushed the branch from{" "}
          <code className="font-mono text-foreground">
            {event.beforeSha?.slice(0, 7)}
          </code>{" "}
          to{" "}
          <Link
            href={`/${username}/${repo}/commit/${event.commitSha}`}
            className="font-mono text-foreground hover:underline"
          >
            {event.commitSha?.slice(0, 7)}
          </Link>{" "}
          · <FromNowHoverCard date={event.createdAt} />
        </p>
      );
    }

    if (item.kind === "event") {
      const { event } = item;
      return (
        <p key={item.id} className="px-4 text-xs text-muted-foreground">
          <UserLink
            username={event.actorUsername}
            image={event.actorImage}
            avatar="xs"
            className="align-middle"
          />{" "}
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
        <UserLink username={item.actorUsername} /> mentioned this in
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
