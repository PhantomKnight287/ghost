"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import {
  createLabel,
  deleteLabel,
  setIssueAssignees,
  setIssueLabels,
} from "@/components/issues/actions";
import { AssigneePicker } from "@/components/issues/assignee-picker";
import { LabelBadge } from "@/components/issues/label-badge";
import { LabelForm } from "@/components/issues/label-form";
import { UserLink } from "@/components/users/user-link";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { IssueLabel } from "@/types/issue";

export function LabelEditor({
  username,
  repo,
  number,
  attached,
  available,
  canEdit,
  canManage,
}: {
  username: string;
  repo: string;
  number: number;
  attached: IssueLabel[];
  available: IssueLabel[];
  canEdit: boolean;
  /** Create and delete the repository's labels, not just apply them. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
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

  const create = useAction(createLabel, {
    onSuccess: ({ data }) => {
      // Attach it right away: creating one from here means you want it.
      if (data) setSelected((current) => [...current, data.name]);
      setCreating(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not create this label."),
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
              <LabelBadge key={label.id} label={label} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Not a `<form>`: the create form below is one, and forms cannot nest.
  return (
    <div className="flex flex-col gap-2">
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
              title={label.description ?? undefined}
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
              {canManage && (
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
              )}
            </label>
          ))}
        </div>
      )}

      {canManage && (
        <div className="border-t pt-2">
          {creating ? (
            <LabelForm
              id={`issue-${number}-label`}
              submitText="Create"
              pending={create.isExecuting}
              onCancel={() => setCreating(false)}
              onSubmit={(values) =>
                create.execute({ ...values, username, repo })
              }
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setCreating(true)}
            >
              <Plus data-icon="inline-start" />
              New label
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/${username}/${repo}/labels`}
          className="text-xs text-muted-foreground hover:underline"
        >
          Manage labels
        </Link>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={save.isExecuting}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={save.isExecuting}
            onClick={() =>
              save.execute({ username, repo, number, names: selected })
            }
          >
            {save.isExecuting && <Spinner />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AssigneeEditor({
  username,
  repo,
  number,
  assignees,
  viewer,
  canEdit,
}: {
  username: string;
  repo: string;
  number: number;
  assignees: string[];
  viewer?: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(assignees);

  const save = useAction(setIssueAssignees, {
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not save assignees."),
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
                setDraft(assignees);
                setEditing(true);
              }}
            >
              <Pencil data-icon="inline-start" />
              Edit
            </Button>
          )}
        </div>
        {assignees.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No one assigned
            {canEdit && viewer && (
              <>
                {" "}
                &middot;{" "}
                <button
                  type="button"
                  className="hover:text-primary hover:underline disabled:opacity-50"
                  disabled={save.isExecuting}
                  onClick={() =>
                    save.execute({
                      username,
                      repo,
                      number,
                      usernames: [viewer],
                    })
                  }
                >
                  assign yourself
                </button>
              </>
            )}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {assignees.map((name) => (
              <li key={name} className="text-xs">
                <UserLink username={name} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.execute({ username, repo, number, usernames: draft });
      }}
    >
      <h2 className="text-xs font-medium text-muted-foreground">Assignees</h2>
      <AssigneePicker
        username={username}
        repo={repo}
        value={draft}
        onChange={setDraft}
        viewer={viewer}
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
