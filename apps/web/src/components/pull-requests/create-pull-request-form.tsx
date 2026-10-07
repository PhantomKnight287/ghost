"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";

import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import { BranchSelect } from "@/components/repositories/branch-select";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { CreatePullRequestFormProps } from "@/types/pull-request";
import { createPullRequest } from "./actions";
import {
  type CreatePullRequestInput,
  createPullRequestSchema,
  titleFromBranch,
} from "./common";

export function CreatePullRequestForm({
  username,
  repo,
  bases,
  heads,
  defaultBase,
  defaultHead,
}: CreatePullRequestFormProps) {
  const router = useRouter();
  const {
    control,
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, dirtyFields },
  } = useForm<CreatePullRequestInput>({
    resolver: zodResolver(createPullRequestSchema),
    defaultValues: {
      title: titleFromBranch(defaultHead),
      body: "",
      base: defaultBase,
      head: defaultHead,
    },
  });

  const { execute, isExecuting, result } = useAction(createPullRequest);
  const base = watch("base");
  const head = watch("head");

  // The diff is rendered on the server, so the pair being compared lives in the URL.
  function preview(next: Partial<{ base: string; head: string }>) {
    const params = new URLSearchParams({ base, head, ...next });
    router.replace(`?${params}`, { scroll: false });
  }

  return (
    <form
      onSubmit={handleSubmit((input) => execute({ ...input, username, repo }))}
      className="contents"
    >
      <FieldGroup>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="pull-base">Merge into</FieldLabel>
            <Controller
              control={control}
              name="base"
              render={({ field }) => (
                <BranchSelect
                  id="pull-base"
                  branches={bases}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    preview({ base: value });
                  }}
                  className="w-full"
                />
              )}
            />
            <FieldError errors={[errors.base]} />
          </Field>

          <span className="hidden pt-8 text-muted-foreground sm:inline">←</span>

          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="pull-head">Merge from</FieldLabel>
            <Controller
              control={control}
              name="head"
              render={({ field }) => (
                <BranchSelect
                  id="pull-head"
                  branches={heads.filter((branch) => branch !== base)}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    // the title follows the branch until someone writes their own
                    if (!dirtyFields.title)
                      setValue("title", titleFromBranch(value));
                    preview({ head: value });
                  }}
                  className="w-full"
                />
              )}
            />
            <FieldError errors={[errors.head]} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="pull-title">Title</FieldLabel>
          <Input
            id="pull-title"
            placeholder="Add a rate limiter"
            autoComplete="off"
            aria-invalid={Boolean(errors.title)}
            {...register("title")}
          />
          <FieldError errors={[errors.title]} />
        </Field>

        <Field>
          <FieldLabel htmlFor="pull-body">
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
                id="pull-body"
                value={field.value ?? ""}
                onChange={field.onChange}
                repository={{ username, repo }}
                rows={8}
                placeholder="What does this change, and why? Link the issues it closes with “Fixes #123”."
                invalid={Boolean(errors.body)}
                disabled={isExecuting}
              />
            )}
          />
          <FieldError errors={[errors.body]} />
        </Field>

        {result.serverError && <FieldError>{result.serverError}</FieldError>}
      </FieldGroup>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" asChild>
          <Link href={`/${username}/${repo}/pulls`}>Cancel</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isExecuting || heads.length === 0 || !head}
          // a button outside submit skips the form's validation, which holds back text with uploads still in it
          onClick={(event) =>
            event.currentTarget.form?.reportValidity() &&
            handleSubmit((input) =>
              execute({ ...input, username, repo, draft: true }),
            )(event)
          }
        >
          Create draft
        </Button>
        <Button
          type="submit"
          disabled={isExecuting || heads.length === 0 || !head}
        >
          {isExecuting && <Spinner />}
          Create pull request
        </Button>
      </div>
    </form>
  );
}
