"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { setIssueAssignees } from "@/components/issues/actions";
import { AssigneePicker } from "@/components/issues/assignee-picker";
import { UserLink } from "@/components/users/user-link";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SidebarSectionHeader } from "./sidebar-section-header";

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
        <SidebarSectionHeader
          title="Assignees"
          onEdit={
            canEdit
              ? () => {
                  setDraft(assignees);
                  setEditing(true);
                }
              : undefined
          }
        />
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
      <SidebarSectionHeader title="Assignees" />
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
