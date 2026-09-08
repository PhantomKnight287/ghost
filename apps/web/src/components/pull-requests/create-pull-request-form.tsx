"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import type { CreatePullRequestFormProps } from "@/types/pull-request";
import { createPullRequest } from "./actions";
import { type CreatePullRequestInput, createPullRequestSchema } from "./common";

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
    watch,
    formState: { errors },
  } = useForm<CreatePullRequestInput>({
    resolver: zodResolver(createPullRequestSchema),
    defaultValues: {
      title: "",
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
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    preview({ base: value });
                  }}
                >
                  <SelectTrigger id="pull-base" className="w-full">
                    <SelectValue placeholder="Select a branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {bases.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    preview({ head: value });
                  }}
                >
                  <SelectTrigger id="pull-head" className="w-full">
                    <SelectValue placeholder="Select a branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {heads
                      .filter((branch) => branch !== base)
                      .map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
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
          <Textarea
            id="pull-body"
            rows={6}
            aria-invalid={Boolean(errors.body)}
            {...register("body")}
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
