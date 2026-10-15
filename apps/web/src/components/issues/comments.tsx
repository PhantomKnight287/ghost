"use client";

import {
  CircleCheck,
  CircleDot,
  Ellipsis,
  Link2,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
  closeIssue,
  commentOnIssue,
  deleteIssueComment,
  reopenIssue,
  updateIssueComment,
} from "@/components/issues/actions";
import {
  deleteReviewComment,
  updateReviewComment,
  updateReviewSummary,
} from "@/components/pull-requests/actions";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useCopy } from "@/lib/use-copy";

export function CommentBox({
  username,
  repo,
  number,
  signedIn,
  state,
  canChangeState = false,
}: {
  username: string;
  repo: string;
  number: number;
  signedIn: boolean;
  state?: string;
  canChangeState?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");

  const close = useAction(closeIssue, {
    onSuccess: () => {
      toast.success("Issue closed.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not close this issue."),
  });

  const reopen = useAction(reopenIssue, {
    onSuccess: () => {
      toast.success("Issue reopened.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not reopen this issue."),
  });

  const comment = useAction(commentOnIssue, {
    onSuccess: () => {
      setBody("");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(
        error.validationErrors?.body?._errors?.[0] ??
          error.serverError ??
          "Could not post this comment.",
      ),
  });

  if (!signedIn) {
    return (
      <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        <Link href="/auth/sign-in" className="text-primary hover:underline">
          Sign in
        </Link>{" "}
        to join the conversation.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        comment.execute({ username, repo, number, body });
      }}
    >
      <MarkdownEditor
        value={body}
        onChange={setBody}
        repository={{ username, repo }}
        placeholder="Leave a comment"
        disabled={comment.isExecuting}
      />

      <div className="flex flex-wrap justify-end gap-2">
        {canChangeState &&
          (state === "open" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={close.isExecuting}
              onClick={() => close.execute({ username, repo, number })}
            >
              {close.isExecuting && <Spinner />}
              <CircleCheck data-icon="inline-start" />
              Close issue
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reopen.isExecuting}
              onClick={() => reopen.execute({ username, repo, number })}
            >
              {reopen.isExecuting && <Spinner />}
              <CircleDot data-icon="inline-start" />
              Reopen issue
            </Button>
          ))}
        <Button
          type="submit"
          size="sm"
          disabled={comment.isExecuting || body.trim().length === 0}
        >
          {comment.isExecuting && <Spinner />}
          Comment
        </Button>
      </div>
    </form>
  );
}

// A review's summary can be edited but not deleted: the review stays, with or without one.
const commentActions = {
  issue: { update: updateIssueComment, remove: deleteIssueComment },
  "review-comment": {
    update: updateReviewComment,
    remove: deleteReviewComment,
  },
  review: { update: updateReviewSummary, remove: null },
};

// The fragments GitHub uses, which the API's `html_url`s already carry, so a link copied here and one from the API land on the same comment.
export const commentAnchor = {
  issue: "issuecomment-",
  "review-comment": "discussion_r",
  review: "pullrequestreview-",
};

/** A comment with its header; a menu at the header's right copies a link to it and holds Edit and Delete. Line comments sit in a thread, so their header is a plain row rather than a card's top bar. */
export function CommentItem({
  kind = "issue",
  username,
  repo,
  number,
  commentId,
  authorUsername,
  body,
  viewer,
  canModerate,
  header,
  children,
}: {
  kind?: keyof typeof commentActions;
  username: string;
  repo: string;
  number: number;
  commentId: string;
  authorUsername: string;
  body: string;
  viewer?: string | null;
  canModerate: boolean;
  header: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Only the author edits a comment; a moderator may only take it down.
  const canEdit = viewer === authorUsername;
  const canDelete = canEdit || canModerate;

  const actions = commentActions[kind];
  const update = useAction(actions.update, {
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not save this comment."),
  });

  const remove = useAction(actions.remove ?? deleteIssueComment, {
    onSuccess: () => router.refresh(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not delete this comment."),
  });

  const anchor = `${commentAnchor[kind]}${commentId}`;
  const link = useCopy(() => {
    const url = new URL(location.href);
    url.hash = anchor;
    return url.toString();
  }, "Could not copy the link.");

  const inThread = kind === "review-comment";
  const content = (
    <>
      <div
        className={
          inThread
            ? "flex min-h-7 flex-wrap items-center gap-2 px-4 pt-3 text-xs text-muted-foreground"
            : "flex min-h-11 flex-wrap items-center gap-1.5 border-b bg-muted/40 px-4 py-1.5 text-sm text-muted-foreground"
        }
      >
        {header}
        {!editing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                disabled={remove.isExecuting}
                aria-label="Comment actions"
              >
                {remove.isExecuting ? <Spinner /> : <Ellipsis />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={async () => {
                  if (await link.copy()) toast.success("Link copied.");
                }}
              >
                <Link2 />
                Copy link
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem
                  onSelect={() => {
                    setDraft(body);
                    setEditing(true);
                  }}
                >
                  <Pencil />
                  Edit
                </DropdownMenuItem>
              )}
              {canDelete && actions.remove && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    remove.execute({ username, repo, number, commentId })
                  }
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="px-4 py-3">
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              update.execute({
                username,
                repo,
                number,
                commentId,
                body: draft,
              });
            }}
          >
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              repository={{ username, repo }}
              autoFocus
              disabled={update.isExecuting}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={update.isExecuting}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                // Clearing a review's summary is allowed; a comment cannot be emptied.
                disabled={
                  update.isExecuting || (kind !== "review" && !draft.trim())
                }
              >
                {update.isExecuting && <Spinner />}
                Save
              </Button>
            </div>
          </form>
        ) : (
          <div className="text-sm">{children}</div>
        )}
      </div>
    </>
  );

  // A review's own row carries its anchor, so a review without a summary can be linked too.
  const id = kind === "review" ? undefined : anchor;
  return (
    <div
      id={id}
      className={cn(
        "scroll-mt-20 target:bg-primary/5",
        !inThread && "rounded-lg border",
      )}
    >
      {content}
    </div>
  );
}
