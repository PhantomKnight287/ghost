"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import { deleteRepository, updateRepository } from "./actions";
import { type UpdateRepositoryInput, updateRepositorySchema } from "./common";
import { VisibilityField } from "./visibility-field";

export function RepositorySettings({
  username,
  slug,
  name,
  description,
  visibility,
  defaultBranch,
  branches,
}: {
  username: string;
  slug: string;
  name: string;
  description?: string | null;
  visibility: "public" | "private";
  defaultBranch: string | null;
  branches: string[];
}) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<UpdateRepositoryInput>({
    resolver: zodResolver(updateRepositorySchema),
    defaultValues: {
      name,
      description: description ?? "",
      visibility,
      defaultBranch: defaultBranch ?? undefined,
    },
  });

  const { execute, isExecuting, result } = useAction(updateRepository);

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <form
        onSubmit={handleSubmit((input) =>
          execute({ ...input, username, slug }),
        )}
        className="contents"
      >
        <FieldGroup>
          <h2 className="text-lg font-semibold">General</h2>

          <Field>
            <FieldLabel htmlFor="settings-name">Repository name</FieldLabel>
            <Input
              id="settings-name"
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
            />
            <FieldDescription>
              Renaming changes the URL. Links and remotes using the old one stop
              working.
            </FieldDescription>
            <FieldError errors={[errors.name]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="settings-description">Description</FieldLabel>
            <Textarea
              id="settings-description"
              rows={3}
              aria-invalid={Boolean(errors.description)}
              {...register("description")}
            />
            <FieldError errors={[errors.description]} />
          </Field>

          {branches.length > 0 && (
            <Field>
              <FieldLabel htmlFor="settings-default-branch">
                Default branch
              </FieldLabel>
              <Controller
                control={control}
                name="defaultBranch"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="settings-default-branch"
                      className="w-full sm:w-64"
                    >
                      <SelectValue placeholder="Select a branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>
                The branch the repository opens on and clones check out.
              </FieldDescription>
            </Field>
          )}

          <FieldSeparator />

          <Controller
            control={control}
            name="visibility"
            render={({ field }) => (
              <VisibilityField
                id="settings-visibility"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />

          {result.serverError && <FieldError>{result.serverError}</FieldError>}
        </FieldGroup>

        <div className="flex justify-end">
          <Button type="submit" disabled={isExecuting || !isDirty}>
            {isExecuting && <Spinner />}
            Save changes
          </Button>
        </div>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/50 p-4 sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-col gap-1">
            <p className="text-sm font-medium">Delete this repository</p>
            <p className="text-sm text-muted-foreground">
              Its code, issues, pull requests and stars are gone for good. Forks
              are kept.
            </p>
          </div>
          <DeleteRepositoryDialog username={username} slug={slug} />
        </div>
      </section>
    </div>
  );
}

function DeleteRepositoryDialog({
  username,
  slug,
}: {
  username: string;
  slug: string;
}) {
  const [confirmation, setConfirmation] = useState("");
  const { execute, isExecuting, result } = useAction(deleteRepository);
  const fullName = `${username}/${slug}`;

  return (
    <AlertDialog onOpenChange={() => setConfirmation("")}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="shrink-0">
          Delete repository
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete {fullName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. The code, issues, pull requests and stars are
            removed.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field>
          <FieldLabel htmlFor="delete-confirmation">
            Type <span className="font-mono">{fullName}</span> to confirm
          </FieldLabel>
          <Input
            id="delete-confirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {result.serverError && <FieldError>{result.serverError}</FieldError>}
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isExecuting}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={isExecuting || confirmation !== fullName}
            onClick={() => execute({ username, slug })}
          >
            {isExecuting && <Spinner />}
            Delete repository
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
