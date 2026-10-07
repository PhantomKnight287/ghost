"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { AssigneePicker } from "@/components/issues/assignee-picker";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { IssueLabel } from "@/types/issue";
import { cn } from "@/lib/utils";
import { createIssue } from "./actions";
import { type CreateIssueInput, createIssueSchema } from "./common";

export function CreateIssueForm({
  username,
  repo,
  labels,
  viewer,
}: {
  username: string;
  repo: string;
  labels: IssueLabel[];
  viewer: string;
}) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateIssueInput>({
    resolver: zodResolver(createIssueSchema),
    defaultValues: { title: "", body: "" },
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);

  const { execute, isExecuting, result } = useAction(createIssue);

  function toggleLabel(name: string) {
    setSelected((current) =>
      current.includes(name)
        ? current.filter((label) => label !== name)
        : [...current, name],
    );
  }

  return (
    <form
      onSubmit={handleSubmit((input) =>
        execute({
          ...input,
          username,
          repo,
          labels: selected,
          assignees,
        }),
      )}
      className="contents"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="issue-title">Title</FieldLabel>
            <Input
              id="issue-title"
              placeholder="Login fails with 500 on Safari"
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(errors.title)}
              {...register("title")}
            />
            <FieldError errors={[errors.title]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="issue-body">
              Description
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <Controller
              control={control}
              name="body"
              render={({ field }) => (
                <MarkdownEditor
                  id="issue-body"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  repository={{ username, repo }}
                  rows={10}
                  placeholder="Steps to reproduce, expected behavior, screenshots…"
                  invalid={Boolean(errors.body)}
                  disabled={isExecuting}
                />
              )}
            />
            <FieldError errors={[errors.body]} />
          </Field>

          {result.serverError && <FieldError>{result.serverError}</FieldError>}
        </FieldGroup>

        <aside className="flex flex-col gap-6">
          <Field>
            <FieldLabel htmlFor="issue-assignees">Assignees</FieldLabel>
            <AssigneePicker
              id="issue-assignees"
              username={username}
              repo={repo}
              value={assignees}
              onChange={setAssignees}
              viewer={viewer}
              disabled={isExecuting}
            />
          </Field>

          <Field>
            <FieldLabel>Labels</FieldLabel>
            {labels.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No labels in this repository yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                  const active = selected.includes(label.name);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => toggleLabel(label.name)}
                      aria-pressed={active}
                      title={label.description ?? undefined}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                        active
                          ? "border-primary bg-muted"
                          : "hover:bg-muted/50",
                      )}
                    >
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: `#${label.color}` }}
                      />
                      {label.name}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        </aside>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" asChild>
          <Link href={`/${username}/${repo}/issues`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={isExecuting}>
          {isExecuting && <Spinner />}
          Create issue
        </Button>
      </div>
    </form>
  );
}
