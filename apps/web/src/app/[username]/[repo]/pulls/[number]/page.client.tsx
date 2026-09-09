"use client";

import { GitMerge, Pencil } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  closePullRequest,
  commentOnPullRequest,
  mergePullRequest,
  updatePullRequest,
} from "@/components/pull-requests/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function PullRequestNav({
  base,
  commitCount,
  changedFiles,
}: {
  base: string;
  commitCount: number;
  changedFiles: number;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: base, label: "Overview", count: null },
    { href: `${base}/commits`, label: "Commits", count: commitCount },
    { href: `${base}/files`, label: "Files changed", count: changedFiles },
  ];

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            pathname === tab.href
              ? "border-primary font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== null && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
              {tab.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function MergePanel({
  username,
  repo,
  number,
  state,
  mergeable,
  canMerge,
  isAuthor,
  mergeCommitSha,
}: {
  username: string;
  repo: string;
  number: number;
  state: string;
  mergeable: boolean;
  canMerge: boolean;
  isAuthor: boolean;
  mergeCommitSha: string | null;
}) {
  const router = useRouter();

  const merge = useAction(mergePullRequest, {
    onSuccess: () => {
      toast.success("Pull request merged.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not merge this pull request."),
  });

  const close = useAction(closePullRequest, {
    onSuccess: () => {
      toast.success("Pull request closed.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not close this pull request."),
  });

  if (state === "merged") {
    return (
      <div className="rounded-lg border px-4 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-violet-500">
          <GitMerge className="size-4" />
          Merged
        </p>
        {mergeCommitSha && (
          <p className="mt-1 text-xs text-muted-foreground">
            Merge commit{" "}
            <Link
              href={`/${username}/${repo}/commit/${mergeCommitSha}`}
              className="font-mono hover:underline"
            >
              {mergeCommitSha.slice(0, 7)}
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (state === "closed") {
    return (
      <div className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        This pull request was closed without merging.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border px-4 py-3">
      <p className="text-sm">
        {mergeable
          ? "This branch has no conflicts with the base branch."
          : "This branch has conflicts that must be resolved locally."}
      </p>

      <div className="flex flex-wrap gap-2">
        {canMerge && (
          <Button
            size="sm"
            disabled={!mergeable || merge.isExecuting}
            onClick={() => merge.execute({ username, repo, number })}
          >
            {merge.isExecuting && <Spinner />}
            <GitMerge data-icon="inline-start" />
            Merge pull request
          </Button>
        )}

        {(canMerge || isAuthor) && (
          <Button
            size="sm"
            variant="outline"
            disabled={close.isExecuting}
            onClick={() => close.execute({ username, repo, number })}
          >
            {close.isExecuting && <Spinner />}
            Close pull request
          </Button>
        )}
      </div>
    </div>
  );
}

export function CommentBox({
  username,
  repo,
  number,
  signedIn,
}: {
  username: string;
  repo: string;
  number: number;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");

  const comment = useAction(commentOnPullRequest, {
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
        to comment on this pull request.
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

      <div className="flex justify-end">
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

/**
 * Read view until the pencil is clicked, then a single field editing the
 * request's title or description. Both fields are the same PATCH, so both use
 * this; nothing else about a request is editable.
 */
export function EditableField({
  username,
  repo,
  number,
  field,
  value,
  canEdit,
  children,
}: {
  username: string;
  repo: string;
  number: number;
  field: "title" | "body";
  value: string;
  canEdit: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const update = useAction(updatePullRequest, {
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(
        error.validationErrors?.[field]?._errors?.[0] ??
          error.serverError ??
          "Could not save this change.",
      ),
  });

  if (!canEdit) return children;

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        update.execute(
          field === "title"
            ? { username, repo, number, title: draft }
            : { username, repo, number, body: draft.trim() ? draft : null },
        );
      }}
    >
      {field === "title" ? (
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={200}
          autoFocus
          disabled={update.isExecuting}
        />
      ) : (
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={6}
          maxLength={20000}
          placeholder="Describe this pull request. Markdown is supported."
          autoFocus
          disabled={update.isExecuting}
        />
      )}

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
          disabled={update.isExecuting || (field === "title" && !draft.trim())}
        >
          {update.isExecuting && <Spinner />}
          Save
        </Button>
      </div>
    </form>
  );
}
