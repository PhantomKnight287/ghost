"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleDot,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Mail,
  MailOpen,
} from "lucide-react";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { FromNowHoverCard } from "@/components/from-now-card";
import { setNotificationUnread } from "@/components/notifications/actions";
import {
  type Notification,
  UNREAD_COUNT_KEY,
} from "@/components/notifications/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REASONS: Record<Notification["reason"], string> = {
  assigned: "Assigned",
  mentioned: "Mentioned",
  team_mentioned: "Team mentioned",
  author: "Author",
  subscribed: "Subscribed",
  watching: "Watching",
};

const VERBS: Record<string, string> = {
  "issue.opened": "opened this",
  "issue.commented": "commented",
  "issue.closed": "closed this",
  "issue.reopened": "reopened this",
  "issue.assigned": "assigned someone",
  "pull_request.merged": "merged this",
  "pull_request.reviewed": "reviewed this",
  "pull_request.review_commented": "replied to a review",
};

function iconOf({ isPullRequest, state }: Notification["thread"]) {
  if (!isPullRequest) {
    return state === "open"
      ? { Icon: CircleDot, color: "text-emerald-600" }
      : { Icon: CircleCheck, color: "text-violet-600" };
  }
  if (state === "merged") return { Icon: GitMerge, color: "text-violet-600" };
  return state === "open"
    ? { Icon: GitPullRequest, color: "text-emerald-600" }
    : { Icon: GitPullRequestClosed, color: "text-red-600" };
}

export function NotificationItem({
  notification,
}: {
  notification: Notification;
}) {
  const queryClient = useQueryClient();
  const { execute, isExecuting } = useAction(setNotificationUnread, {
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY }),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not update this notification."),
  });

  const { repository, thread, unread } = notification;
  const { Icon, color } = iconOf(thread);
  const href = `/${repository.owner}/${repository.slug}/${thread.isPullRequest ? "pulls" : "issues"}/${thread.number}`;
  const ToggleIcon = unread ? MailOpen : Mail;

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3 text-sm",
        !unread && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <Icon className={cn("size-4 shrink-0", color)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">
          {repository.owner}/{repository.slug} #{thread.number}
        </p>
        <Link
          href={href}
          onClick={() =>
            unread && execute({ id: notification.id, unread: false })
          }
          className={cn(
            "block truncate hover:underline",
            unread && "font-medium",
          )}
        >
          {thread.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {notification.actorUsername ?? "Someone"}{" "}
          {VERBS[notification.eventType] ?? "updated this"} ·{" "}
          <FromNowHoverCard date={notification.updatedAt} />
        </p>
      </div>
      <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
        {REASONS[notification.reason]}
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        disabled={isExecuting}
        aria-label={unread ? "Mark as read" : "Mark as unread"}
        title={unread ? "Mark as read" : "Mark as unread"}
        onClick={() => execute({ id: notification.id, unread: !unread })}
      >
        <ToggleIcon />
      </Button>
    </li>
  );
}
