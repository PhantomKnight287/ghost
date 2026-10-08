import {
  CircleCheck,
  CircleDot,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
} from "lucide-react";

import { cn } from "@/lib/utils";

const STYLES = {
  issue: {
    open: {
      Icon: CircleDot,
      text: "text-emerald-600",
      badge: "bg-emerald-600 text-white",
    },
    closed: {
      Icon: CircleCheck,
      text: "text-red-600",
      badge: "bg-red-600 text-white",
    },
    merged: {
      Icon: CircleCheck,
      text: "text-red-600",
      badge: "bg-red-600 text-white",
    },
  },
  pull: {
    open: {
      Icon: GitPullRequest,
      text: "text-emerald-600",
      badge: "bg-emerald-600 text-white",
    },
    closed: {
      Icon: GitPullRequestClosed,
      text: "text-red-600",
      badge: "bg-red-600 text-white",
    },
    merged: {
      Icon: GitMerge,
      text: "text-violet-600",
      badge: "bg-violet-600 text-white",
    },
  },
};

/** The icon and colours that mark an issue or pull request as open, closed or merged. */
export function threadStateStyle(
  isPullRequest: boolean,
  state: "open" | "closed" | "merged",
) {
  return STYLES[isPullRequest ? "pull" : "issue"][state];
}

export function ThreadStateIcon({
  isPullRequest,
  state,
  className,
}: {
  isPullRequest: boolean;
  state: "open" | "closed" | "merged";
  className?: string;
}) {
  const { Icon, text } = threadStateStyle(isPullRequest, state);
  return <Icon className={cn("size-4 shrink-0", text, className)} />;
}
