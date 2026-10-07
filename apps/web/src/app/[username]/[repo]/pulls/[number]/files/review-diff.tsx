"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";

import {
  addPendingComment,
  discardPendingReview,
  submitReview,
} from "@/components/pull-requests/actions";
import { DiffView } from "@/components/pull-requests/diff-view";
import { ReviewThread } from "@/components/pull-requests/review";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import type { LineAnnotations, LineCommentHandler } from "@/types/diffs";
import type {
  PullRequestFile,
  RepositoryBlob,
  PullRequestReview,
  ReviewComment,
} from "@/types/pull-request";

type Verdict = NonNullable<PullRequestReview["state"]>;
type LineTarget = Omit<ReviewComment, "body">;
type LineAnchor = Pick<LineTarget, "path" | "side" | "line">;
type Viewing = {
  username: string;
  repo: string;
  number: number;
  viewer: string | null;
  canModerate: boolean;
};

/** The diff with the threads on the head it shows, the viewer's pending comments, and the form that submits them as one review. */
export function ReviewDiff({
  from,
  to,
  patchUrl,
  files,
  reviews,
  pending,
  canReview,
  isAuthor,
  blobUrl,
  ...viewing
}: Viewing & {
  from: string;
  to: string;
  /** Blob endpoint of the head repository, which a suggestion is prefilled from; null once that repository is gone. */
  blobUrl: string | null;
  patchUrl: string;
  files: PullRequestFile[];
  /** Submitted reviews. Threads on another head are outdated and stay in the conversation. */
  reviews: PullRequestReview[];
  /** The viewer's unsubmitted review. */
  pending: PullRequestReview | null;
  /** Signed in, and the request is still open. */
  canReview: boolean;
  isAuthor: boolean;
}) {
  const [target, setTarget] = useState<LineTarget | null>(null);

  const onLineComment = useCallback<LineCommentHandler>((path, range) => {
    const startSide = range.side ?? "additions";
    const side = range.endSide ?? startSide;
    // A drag upwards arrives end first.
    const [startLine, line] =
      startSide === side && range.start > range.end
        ? [range.end, range.start]
        : [range.start, range.end];
    setTarget(
      startLine === line && startSide === side
        ? { path, side, line }
        : { path, side, line, startSide, startLine },
    );
  }, []);

  const annotations: Record<string, LineAnnotations> = {};
  const annotate = (at: LineAnchor, node: ReactNode) => {
    annotations[at.path] ??= [];
    annotations[at.path].push({
      side: at.side,
      lineNumber: at.line,
      metadata: node,
    });
  };
  for (const review of [...reviews, ...(pending ? [pending] : [])]) {
    for (const thread of review.comments) {
      if (thread.commitSha !== to) continue;
      annotate(
        thread,
        <ReviewThread
          {...viewing}
          thread={thread}
          pending={review === pending}
          canApply={
            canReview && (viewing.canModerate || isAuthor) && review !== pending
          }
        />,
      );
    }
  }
  if (target) {
    annotate(
      target,
      <LineCommentForm
        {...viewing}
        target={target}
        hasPending={pending !== null}
        fileUrl={
          blobUrl &&
          `${blobUrl}?${new URLSearchParams({ path: target.path, ref: to })}`
        }
        onDone={() => setTarget(null)}
      />,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canReview && (
        <SubmitReviewForm
          {...viewing}
          pendingCount={pending?.comments.length ?? 0}
          isAuthor={isAuthor}
        />
      )}

      <DiffView
        from={from}
        to={to}
        patchUrl={patchUrl}
        files={files}
        annotations={annotations}
        onLineComment={canReview ? onLineComment : undefined}
      />
    </div>
  );
}

function LineCommentForm({
  username,
  repo,
  number,
  target,
  hasPending,
  fileUrl,
  onDone,
}: Viewing & {
  target: LineTarget;
  hasPending: boolean;
  /** The file at the head, for prefilling a suggestion with the lines it replaces. */
  fileUrl: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const callbacks = {
    onSuccess: () => {
      onDone();
      router.refresh();
    },
    onError: ({ error }: { error: { serverError?: string } }) =>
      toast.error(error.serverError ?? "Could not save this comment."),
  };
  const single = useAction(submitReview, callbacks);
  const add = useAction(addPendingComment, callbacks);
  const busy = single.isExecuting || add.isExecuting;
  const comment = { ...target, body };
  const first = target.startLine ?? target.line;
  const suggestable =
    fileUrl !== null &&
    target.side === "additions" &&
    (target.startSide ?? target.side) === "additions";

  // Starts from the lines being replaced, so the reviewer edits them rather than retyping; an empty block still works if the file cannot be read.
  async function suggest() {
    const lines = fileUrl
      ? await fetch(fileUrl, { credentials: "include" })
          .then((response) => (response.ok ? response.json() : null))
          .then((blob: RepositoryBlob | null) =>
            blob?.encoding === "utf-8" && blob.content !== null
              ? blob.content
                  .split(/\r?\n/)
                  .slice(first - 1, target.line)
                  .join("\n")
              : "",
          )
          .catch(() => "")
      : "";
    setBody(`${body}${body ? "\n" : ""}\`\`\`suggestion\n${lines}\n\`\`\`\n`);
  }

  return (
    <form
      className="flex flex-col gap-2 bg-background p-3 font-sans"
      onSubmit={(event) => {
        event.preventDefault();
        add.execute({ username, repo, number, comment });
      }}
    >
      {target.startLine && (
        <p className="text-xs text-muted-foreground">
          Commenting on lines {first}–{target.line}
        </p>
      )}
      <MarkdownEditor
        value={body}
        onChange={setBody}
        repository={{ username, repo }}
        rows={3}
        placeholder="Leave a comment"
        autoFocus
        disabled={busy}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {suggestable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto"
            disabled={busy}
            onClick={suggest}
          >
            Suggest a change
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        {!hasPending && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !body.trim()}
            onClick={() =>
              single.execute({
                username,
                repo,
                number,
                state: "commented",
                comments: [comment],
              })
            }
          >
            Add single comment
          </Button>
        )}
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>
          {busy && <Spinner />}
          {hasPending ? "Add review comment" : "Start a review"}
        </Button>
      </div>
    </form>
  );
}

function SubmitReviewForm({
  username,
  repo,
  number,
  pendingCount,
  isAuthor,
}: Viewing & { pendingCount: number; isAuthor: boolean }) {
  const router = useRouter();
  const [summary, setSummary] = useState("");
  const [verdict, setVerdict] = useState<Verdict>("commented");

  const submit = useAction(submitReview, {
    onSuccess: () => {
      setSummary("");
      setVerdict("commented");
      toast.success("Review submitted.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not submit this review."),
  });

  const discard = useAction(discardPendingReview, {
    onSuccess: () => router.refresh(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not discard this review."),
  });

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit.execute({
          username,
          repo,
          number,
          state: verdict,
          body: summary,
        });
      }}
    >
      <MarkdownEditor
        value={summary}
        onChange={setSummary}
        repository={{ username, repo }}
        rows={3}
        placeholder="Summarize your review"
        disabled={submit.isExecuting}
      />
      <RadioGroup
        value={verdict}
        onValueChange={(value) => setVerdict(value as Verdict)}
        className="flex flex-wrap gap-4"
      >
        {(
          [
            ["commented", "Comment"],
            ["approved", "Approve"],
            ["changes_requested", "Request changes"],
          ] as const
        )
          // You cannot pass judgement on your own request.
          .filter(([value]) => !isAuthor || value === "commented")
          .map(([value, label]) => (
            <Field key={value} orientation="horizontal" className="w-auto">
              <RadioGroupItem value={value} id={`review-${value}`} />
              <FieldLabel htmlFor={`review-${value}`} className="font-normal">
                {label}
              </FieldLabel>
            </Field>
          ))}
      </RadioGroup>
      <div className="flex flex-wrap justify-end gap-2">
        {pendingCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={discard.isExecuting || submit.isExecuting}
            onClick={() => discard.execute({ username, repo, number })}
          >
            {discard.isExecuting && <Spinner />}
            Discard review
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={
            submit.isExecuting ||
            (verdict === "commented" && !summary.trim() && pendingCount === 0)
          }
        >
          {submit.isExecuting && <Spinner />}
          Submit review
          {pendingCount > 0 &&
            ` (${pendingCount} comment${pendingCount === 1 ? "" : "s"})`}
        </Button>
      </div>
    </form>
  );
}
