"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BookLock, Globe } from "lucide-react";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import { forkRepository } from "./actions";
import { type ForkRepositoryInput, forkRepositorySchema } from "./common";

export function ForkRepositoryForm({
  parentUsername,
  parentSlug,
  name,
  description,
  visibility,
  owners,
  defaultOwner,
}: {
  parentUsername: string;
  parentSlug: string;
  name: string;
  description?: string | null;
  visibility: "public" | "private";
  /** Owners without a fork of this repository yet. Empty means every owner has one. */
  owners: string[];
  defaultOwner: string;
}) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForkRepositoryInput>({
    resolver: zodResolver(forkRepositorySchema),
    defaultValues: {
      owner: defaultOwner,
      name,
      description: description ?? "",
      visibility,
    },
  });

  const { execute, isExecuting, result } = useAction(forkRepository);

  return (
    <form
      onSubmit={handleSubmit((input) =>
        execute({ ...input, parentUsername, parentSlug }),
      )}
      className="contents"
    >
      <FieldGroup>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
          <Field className="w-full sm:w-40 sm:shrink-0">
            <FieldLabel htmlFor="fork-owner">Owner</FieldLabel>
            <Controller
              control={control}
              name="owner"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="fork-owner" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {owners.map((owner) => (
                      <SelectItem key={owner} value={owner}>
                        {owner}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.owner]} />
          </Field>

          <span className="hidden pt-6 text-lg text-muted-foreground sm:inline">
            /
          </span>

          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="fork-name">Repository name</FieldLabel>
            <Input
              id="fork-name"
              placeholder="my-project"
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
            />
            <FieldError errors={[errors.name]} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="fork-description">
            Description
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </FieldLabel>
          <Textarea
            id="fork-description"
            rows={3}
            aria-invalid={Boolean(errors.description)}
            {...register("description")}
          />
          <FieldError errors={[errors.description]} />
        </Field>

        <FieldSeparator />

        <Controller
          control={control}
          name="visibility"
          render={({ field }) => (
            <RadioGroup value={field.value} onValueChange={field.onChange}>
              <FieldLabel htmlFor="fork-visibility-public">
                <Field orientation="horizontal">
                  <Globe className="size-5 text-muted-foreground" />
                  <FieldContent>
                    <FieldTitle>Public</FieldTitle>
                    <FieldDescription>
                      Anyone on the internet can see this repository.
                    </FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="public" id="fork-visibility-public" />
                </Field>
              </FieldLabel>

              <FieldLabel htmlFor="fork-visibility-private">
                <Field orientation="horizontal">
                  <BookLock className="size-5 text-muted-foreground" />
                  <FieldContent>
                    <FieldTitle>Private</FieldTitle>
                    <FieldDescription>
                      You choose who can see and commit to this repository.
                    </FieldDescription>
                  </FieldContent>
                  <RadioGroupItem
                    value="private"
                    id="fork-visibility-private"
                  />
                </Field>
              </FieldLabel>
            </RadioGroup>
          )}
        />

        {result.serverError && <FieldError>{result.serverError}</FieldError>}
      </FieldGroup>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" asChild>
          <Link href={`/${parentUsername}/${parentSlug}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={isExecuting || owners.length === 0}>
          {isExecuting && <Spinner />}
          Create fork
        </Button>
      </div>
    </form>
  );
}
