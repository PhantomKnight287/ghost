"use client";

import { Pencil, PlusIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { IssueLabel } from "@/types/issue";
import { createLabel, deleteLabel, updateLabel } from "./actions";
import { LabelBadge } from "./label-badge";
import { LabelForm } from "./label-form";

export function LabelManager({
  username,
  repo,
  labels,
  canEdit,
}: {
  username: string;
  repo: string;
  labels: IssueLabel[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<IssueLabel | null>(null);

  function reportError(fallback: string) {
    return ({ error }: { error: { serverError?: string } }) =>
      toast.error(error.serverError ?? fallback);
  }

  const create = useAction(createLabel, {
    onSuccess: () => {
      setCreating(false);
      router.refresh();
    },
    onError: reportError("Could not create this label."),
  });

  const update = useAction(updateLabel, {
    onSuccess: () => {
      setEditingId(null);
      router.refresh();
    },
    onError: reportError("Could not save this label."),
  });

  const remove = useAction(deleteLabel, {
    onSuccess: () => {
      setPendingDelete(null);
      router.refresh();
    },
    onError: reportError("Could not delete this label."),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">
          Labels
          <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
            {labels.length}
          </span>
        </h1>
        {canEdit && !creating && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              setEditingId(null);
              setCreating(true);
            }}
          >
            <PlusIcon data-icon="inline-start" />
            New label
          </Button>
        )}
      </div>

      {creating && (
        <div className="rounded-lg border bg-muted/20 px-4 py-3">
          <LabelForm
            id="new-label"
            submitText="Create label"
            pending={create.isExecuting}
            onCancel={() => setCreating(false)}
            onSubmit={(values) => create.execute({ ...values, username, repo })}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        {labels.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            This repository has no labels yet.
          </p>
        ) : (
          <ul className="divide-y">
            {labels.map((label) =>
              label.id === editingId ? (
                <li key={label.id} className="bg-muted/20 px-4 py-3">
                  <LabelForm
                    id={`label-${label.id}`}
                    label={label}
                    submitText="Save"
                    pending={update.isExecuting}
                    onCancel={() => setEditingId(null)}
                    onSubmit={({ name, description, color }) =>
                      update.execute({
                        username,
                        repo,
                        labelId: label.id,
                        name,
                        // An emptied field clears the description.
                        description: description?.trim() || null,
                        color,
                      })
                    }
                  />
                </li>
              ) : (
                <li
                  key={label.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
                >
                  <Link
                    href={`/${username}/${repo}/issues?labels=${encodeURIComponent(label.name)}`}
                    title={`Show issues labelled ${label.name}`}
                  >
                    <LabelBadge label={label} />
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {label.description}
                  </span>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCreating(false);
                          setEditingId(label.id);
                        }}
                      >
                        <Pencil data-icon="inline-start" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(label)}
                      >
                        <Trash2 data-icon="inline-start" />
                        Delete
                      </Button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete the “{pendingDelete?.name}” label?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from every issue that carries it. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isExecuting}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isExecuting}
              onClick={() =>
                pendingDelete &&
                remove.execute({
                  username,
                  repo,
                  labelId: pendingDelete.id,
                })
              }
            >
              {remove.isExecuting && <Spinner />}
              Delete label
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
