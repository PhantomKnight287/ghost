"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { updateIssue } from "@/components/issues/actions";
import { updatePullRequest } from "@/components/pull-requests/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";

/** Read view until Edit is clicked, then a single field editing the title or description of an issue or pull request. With a `header`, the field renders as a card and Edit sits in its top bar. */
export function EditableField({
  username,
  repo,
  number,
  noun,
  field,
  value,
  canEdit,
  header,
  children,
}: {
  username: string;
  repo: string;
  number: number;
  noun: "issue" | "pull request";
  field: "title" | "body";
  value: string;
  canEdit: boolean;
  header?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const update = useAction(noun === "issue" ? updateIssue : updatePullRequest, {
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

  const edit = canEdit && !editing && (
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
  );

  const content = editing ? (
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
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          repository={{ username, repo }}
          rows={6}
          placeholder={`Describe this ${noun}`}
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
  ) : (
    children
  );

  if (header) {
    return (
      <div className="rounded-lg border">
        <div className="flex min-h-11 items-center gap-1.5 border-b bg-muted/40 px-4 py-1.5 text-sm text-muted-foreground">
          {header}
          {edit && <div className="ml-auto">{edit}</div>}
        </div>
        <div className="px-4 py-3 text-sm">{content}</div>
      </div>
    );
  }

  if (!edit) return content;
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">{content}</div>
      {edit}
    </div>
  );
}
