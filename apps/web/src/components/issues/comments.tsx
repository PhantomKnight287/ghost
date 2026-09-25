"use client";

import { CircleCheck, CircleDot, Pencil, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

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
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        maxLength={20000}
        placeholder="Leave a comment. Markdown is supported."
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

export function CommentItem({
  username,
  repo,
  number,
  commentId,
  authorUsername,
  body,
  viewer,
  canModerate,
  children,
}: {
  username: string;
  repo: string;
  number: number;
  commentId: string;
  authorUsername: string;
  body: string;
  viewer?: string | null;
  canModerate: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const canEdit = viewer === authorUsername || canModerate;

  const update = useAction(updateIssueComment, {
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not save this comment."),
  });

  const remove = useAction(deleteIssueComment, {
    onSuccess: () => router.refresh(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not delete this comment."),
  });

  return (
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
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            maxLength={20000}
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
              disabled={update.isExecuting || !draft.trim()}
            >
              {update.isExecuting && <Spinner />}
              Save
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="text-sm">{children}</div>
          {canEdit && (
            <div className="mt-2 flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(body);
                  setEditing(true);
                }}
              >
                <Pencil data-icon="inline-start" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={remove.isExecuting}
                onClick={() =>
                  remove.execute({ username, repo, number, commentId })
                }
              >
                <Trash2 data-icon="inline-start" />
                Delete
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
