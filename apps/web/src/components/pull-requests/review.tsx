"use client";

import { CircleCheck, CircleX, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { DiffHunk } from "@/components/diffs/diff-hunk";
import { FromNowHoverCard } from "@/components/from-now-card";
import { CommentItem } from "@/components/issues/comments";
import { Markdown } from "@/components/markdown";
import { UserLink } from "@/components/users/user-link";
import {
  applySuggestion,
  dismissReview,
  replyToReviewComment,
} from "@/components/pull-requests/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import type {
  PullRequestReview,
  ReviewThread as ReviewThreadData,
} from "@/types/pull-request";

const verdicts = {
  approved: {
    icon: CircleCheck,
    text: "approved these changes",
    tone: "text-emerald-500",
  },
  changes_requested: {
    icon: CircleX,
    text: "requested changes",
    tone: "text-red-500",
  },
  commented: {
    icon: MessageSquare,
    text: "reviewed",
    tone: "text-muted-foreground",
  },
} as const;

type Viewing = {
  username: string;
  repo: string;
  number: number;
  viewer?: string | null;
  /** May delete anyone's comments and dismiss reviews; editing stays with each comment's author. */
  canModerate: boolean;
};

/** A submitted review in the conversation, laid out like GitHub's: a line saying who reviewed and how, then the summary and each file thread as cards of their own beneath it. */
export function ReviewItem({
  review,
  headSha,
  ...viewing
}: Viewing & { review: PullRequestReview; headSha: string }) {
  const { icon: Icon, text, tone } = verdicts[review.state ?? "commented"];
  const { username, repo, number, viewer, canModerate } = viewing;
  const dismissable =
    canModerate && review.state !== "commented" && !review.dismissalMessage;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5 px-4 text-sm text-muted-foreground">
        <Icon className={`size-4 ${tone}`} />
        <UserLink
          username={review.authorUsername}
          image={review.authorImage}
          avatar="sm"
        />
        {text} <FromNowHoverCard date={review.createdAt} />
        {review.dismissalMessage && <Badge variant="outline">Dismissed</Badge>}
        {dismissable && <DismissReview {...viewing} reviewId={review.id} />}
      </div>

      {(review.dismissalMessage ||
        review.body ||
        review.comments.length > 0) && (
        <div className="ml-6 flex flex-col gap-3 border-l-2 pl-4">
          {review.dismissalMessage && (
            <p className="text-xs text-muted-foreground">
              <UserLink username={review.dismissedByUsername ?? ""} /> dismissed
              this review: {review.dismissalMessage}
            </p>
          )}

          {review.body && (
            <CommentItem
              kind="review"
              username={username}
              repo={repo}
              number={number}
              commentId={review.id}
              authorUsername={review.authorUsername}
              body={review.body ?? ""}
              viewer={viewer}
              canModerate={canModerate}
              header={
                <>
                  <UserLink
                    username={review.authorUsername}
                    image={review.authorImage}
                    avatar="sm"
                  />
                  left a review
                </>
              }
            >
              <Markdown repository={{ username, repo }}>{review.body}</Markdown>
            </CommentItem>
          )}

          {review.comments.map((thread) => (
            <div key={thread.id} className="overflow-hidden rounded-lg border">
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 font-mono text-xs">
                <span className="text-foreground">{thread.path}</span>
                <span className="text-muted-foreground">
                  {thread.startLine
                    ? `lines ${thread.startLine}–${thread.line}`
                    : `line ${thread.line}`}
                </span>
                {thread.commitSha !== headSha && (
                  <Badge variant="outline">Outdated</Badge>
                )}
              </div>
              {thread.diffHunk && (
                <div className="border-b">
                  <DiffHunk path={thread.path} hunk={thread.diffHunk} />
                </div>
              )}
              <ReviewThread {...viewing} thread={thread} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A line comment, its replies, and a box to add one. A pending comment takes no replies until its review is submitted. */
export function ReviewThread({
  thread,
  pending = false,
  canApply = false,
  ...viewing
}: Viewing & {
  thread: ReviewThreadData;
  pending?: boolean;
  /** The thread is on the head as it stands and the viewer may push to it, so its suggestions can be applied. */
  canApply?: boolean;
}) {
  const { username, repo, viewer } = viewing;

  return (
    <div className="bg-background font-sans">
      {[thread, ...thread.replies].map((comment) => (
        <div key={comment.id} className="border-b last:border-b-0">
          <CommentItem
            kind="review-comment"
            {...viewing}
            commentId={comment.id}
            authorUsername={comment.authorUsername}
            body={comment.body}
            header={
              <>
                <UserLink
                  username={comment.authorUsername}
                  image={comment.authorImage}
                  avatar="sm"
                />
                <FromNowHoverCard date={comment.createdAt} />
                {pending && <Badge variant="outline">Pending</Badge>}
              </>
            }
          >
            <Markdown repository={{ username, repo }}>{comment.body}</Markdown>
          </CommentItem>
          {canApply && viewer && /^```suggestion/m.test(comment.body) && (
            <ApplySuggestion {...viewing} commentId={comment.id} />
          )}
        </div>
      ))}
      {viewer && !pending && <ReplyBox {...viewing} commentId={thread.id} />}
    </div>
  );
}

function ApplySuggestion({
  username,
  repo,
  number,
  commentId,
}: Viewing & { commentId: string }) {
  const router = useRouter();
  const apply = useAction(applySuggestion, {
    onSuccess: () => {
      toast.success("Suggestion committed to the branch.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not apply this suggestion."),
  });

  return (
    <div className="px-4 pb-3">
      <Button
        size="sm"
        variant="outline"
        disabled={apply.isExecuting}
        onClick={() => apply.execute({ username, repo, number, commentId })}
      >
        {apply.isExecuting && <Spinner />}
        Apply suggestion
      </Button>
    </div>
  );
}

function ReplyBox({
  username,
  repo,
  number,
  commentId,
}: Viewing & { commentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");

  const reply = useAction(replyToReviewComment, {
    onSuccess: () => {
      setBody("");
      setOpen(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(
        error.validationErrors?.body?._errors?.[0] ??
          error.serverError ??
          "Could not post this reply.",
      ),
  });

  if (!open) {
    return (
      <div className="border-t px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Reply
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 border-t px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        reply.execute({ username, repo, number, commentId, body });
      }}
    >
      <MarkdownEditor
        value={body}
        onChange={setBody}
        repository={{ username, repo }}
        rows={3}
        placeholder="Reply"
        autoFocus
        disabled={reply.isExecuting}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={reply.isExecuting}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={reply.isExecuting || !body.trim()}
        >
          {reply.isExecuting && <Spinner />}
          Reply
        </Button>
      </div>
    </form>
  );
}

function DismissReview({
  username,
  repo,
  number,
  reviewId,
}: Viewing & { reviewId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  const dismiss = useAction(dismissReview, {
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(
        error.validationErrors?.message?._errors?.[0] ??
          error.serverError ??
          "Could not dismiss this review.",
      ),
  });

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={() => setOpen(true)}
      >
        Dismiss
      </Button>
    );
  }

  return (
    <form
      className="ml-auto flex w-full gap-2 sm:w-auto"
      onSubmit={(event) => {
        event.preventDefault();
        dismiss.execute({ username, repo, number, reviewId, message });
      }}
    >
      <Input
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={1000}
        placeholder="Why is this review dismissed?"
        autoFocus
        disabled={dismiss.isExecuting}
        className="h-8"
      />
      <Button
        type="submit"
        size="sm"
        disabled={dismiss.isExecuting || !message.trim()}
      >
        {dismiss.isExecuting && <Spinner />}
        Dismiss
      </Button>
    </form>
  );
}
