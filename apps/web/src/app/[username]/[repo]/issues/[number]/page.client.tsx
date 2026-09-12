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
  deleteLabel,
  reopenIssue,
  setIssueAssignees,
  setIssueLabels,
  updateIssue,
  updateIssueComment,
} from "@/components/issues/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { IssueLabel } from "@/types/issue";
import { cn } from "@/lib/utils";

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
        to comment on this issue.
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

/**
 * Read view until the pencil is clicked, then a single field editing the
 * issue's title or description. Both fields are the same PATCH, so both use
 * this; state moves through close/reopen instead.
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

  const update = useAction(updateIssue, {
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
          placeholder="Describe this issue. Markdown is supported."
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

export function LabelEditor({
  username,
  repo,
  number,
  attached,
  available,
  canEdit,
}: {
  username: string;
  repo: string;
  number: number;
  attached: IssueLabel[];
  available: IssueLabel[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(
    attached.map((label) => label.name),
  );

  const save = useAction(setIssueLabels, {
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not save labels."),
  });

  const remove = useAction(deleteLabel, {
    onSuccess: () => router.refresh(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not delete this label."),
  });

  function toggle(name: string) {
    setSelected((current) =>
      current.includes(name)
        ? current.filter((label) => label !== name)
        : [...current, name],
    );
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground">Labels</h2>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setSelected(attached.map((label) => label.name));
                setEditing(true);
              }}
            >
              <Pencil data-icon="inline-start" />
              Edit
            </Button>
          )}
        </div>
        {attached.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {attached.map((label) => (
              <Badge
                key={label.id}
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
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.execute({ username, repo, number, names: selected });
      }}
    >
      <h2 className="text-xs font-medium text-muted-foreground">Labels</h2>
      {available.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No labels in this repository yet.
        </p>
      ) : (
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {available.map((label) => (
            <label
              key={label.id}
              className="group flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={selected.includes(label.name)}
                onChange={() => toggle(label.name)}
                className="accent-current"
              />
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: `#${label.color}` }}
              />
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
              <button
                type="button"
                title={`Delete label ${label.name}`}
                className="invisible text-muted-foreground group-hover:visible hover:text-destructive"
                onClick={() =>
                  remove.execute({ username, repo, labelId: label.id })
                }
              >
                <Trash2 className="size-3" />
              </button>
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={save.isExecuting}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={save.isExecuting}>
          {save.isExecuting && <Spinner />}
          Save
        </Button>
      </div>
    </form>
  );
}

export function AssigneeEditor({
  username,
  repo,
  number,
  assignees,
  canEdit,
}: {
  username: string;
  repo: string;
  number: number;
  assignees: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(assignees.join(", "));

  const save = useAction(setIssueAssignees, {
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(
        error.serverError ?? "Could not save assignees. Check the usernames.",
      ),
  });

  if (!editing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground">
            Assignees
          </h2>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setDraft(assignees.join(", "));
                setEditing(true);
              }}
            >
              <Pencil data-icon="inline-start" />
              Edit
            </Button>
          )}
        </div>
        {assignees.length === 0 ? (
          <p className="text-xs text-muted-foreground">No one assigned.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {assignees.map((name) => (
              <li key={name} className="text-xs">
                <Link
                  href={`/${name}`}
                  className="text-primary hover:underline"
                >
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form
      className={cn("flex flex-col gap-2")}
      onSubmit={(event) => {
        event.preventDefault();
        save.execute({
          username,
          repo,
          number,
          usernames: draft
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        });
      }}
    >
      <h2 className="text-xs font-medium text-muted-foreground">Assignees</h2>
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="octocat, hubot"
        autoComplete="off"
        autoFocus
        disabled={save.isExecuting}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={save.isExecuting}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={save.isExecuting}>
          {save.isExecuting && <Spinner />}
          Save
        </Button>
      </div>
    </form>
  );
}
