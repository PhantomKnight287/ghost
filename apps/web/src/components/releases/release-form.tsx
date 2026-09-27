"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { Release } from "@/types/release";

import { createRelease, updateRelease } from "./actions";
import { type ReleaseInput, releasePath, releaseSchema } from "./common";

/** Creates a release, or edits `release` when given. The tag of an existing release is fixed. */
export function ReleaseForm({
  username,
  repo,
  branches,
  defaultBranch,
  release,
}: {
  username: string;
  repo: string;
  branches: string[];
  defaultBranch: string | null;
  release?: Release;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ReleaseInput>({
    resolver: zodResolver(releaseSchema),
    defaultValues: {
      tagName: release?.tagName ?? "",
      target: defaultBranch ?? undefined,
      name: release?.name ?? "",
      body: release?.body ?? "",
      isPrerelease: release?.isPrerelease ?? false,
    },
  });

  const create = useAction(createRelease);
  const update = useAction(updateRelease);
  const isExecuting = create.isExecuting || update.isExecuting;
  const serverError =
    create.result.serverError ?? update.result.serverError ?? null;

  const submit = (isDraft: boolean) =>
    handleSubmit((input) =>
      release
        ? update.execute({
            username,
            repo,
            id: release.id,
            name: input.name,
            body: input.body,
            isPrerelease: input.isPrerelease,
            isDraft,
          })
        : create.execute({ username, repo, ...input, isDraft }),
    );

  return (
    <form onSubmit={submit(false)} className="contents">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="release-tag">Tag</FieldLabel>
            <Input
              id="release-tag"
              placeholder="v1.0.0"
              autoComplete="off"
              disabled={Boolean(release)}
              aria-invalid={Boolean(errors.tagName)}
              {...register("tagName")}
            />
            <FieldError errors={[errors.tagName]} />
          </Field>

          {!release && branches.length > 0 && (
            <Field>
              <FieldLabel htmlFor="release-target">Target</FieldLabel>
              <Controller
                control={control}
                name="target"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="release-target">
                      <SelectValue placeholder="Select a branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {branches.map((branch) => (
                          <SelectItem key={branch} value={branch}>
                            {branch}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>
                Used only when the tag does not exist yet.
              </FieldDescription>
            </Field>
          )}
        </div>

        <Field>
          <FieldLabel htmlFor="release-name">
            Title
            <span className="font-normal text-muted-foreground">
              (optional, defaults to the tag)
            </span>
          </FieldLabel>
          <Input
            id="release-name"
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field>
          <FieldLabel htmlFor="release-body">Notes</FieldLabel>
          <Textarea
            id="release-body"
            rows={12}
            placeholder="What changed in this release? Markdown is supported."
            aria-invalid={Boolean(errors.body)}
            {...register("body")}
          />
          <FieldError errors={[errors.body]} />
        </Field>

        <Controller
          control={control}
          name="isPrerelease"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id="release-prerelease"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
              <FieldLabel htmlFor="release-prerelease" className="font-normal">
                This is a prerelease, and never marked as the latest
              </FieldLabel>
            </Field>
          )}
        />

        {serverError && <FieldError>{serverError}</FieldError>}
      </FieldGroup>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" asChild>
          <Link
            href={
              release
                ? releasePath(username, repo, release.tagName)
                : `/${username}/${repo}/releases`
            }
          >
            Cancel
          </Link>
        </Button>
        {(!release || release.isDraft) && (
          <Button
            type="button"
            variant="outline"
            disabled={isExecuting}
            onClick={submit(true)}
          >
            Save draft
          </Button>
        )}
        <Button type="submit" disabled={isExecuting}>
          {isExecuting && <Spinner />}
          {release && !release.isDraft ? "Update release" : "Publish release"}
        </Button>
      </div>
    </form>
  );
}

export function ReleaseFormSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="ml-auto h-9 w-36" />
    </div>
  );
}
