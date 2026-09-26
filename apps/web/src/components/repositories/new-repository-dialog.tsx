"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import type { ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
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

import { createRepository } from "./actions";
import { createRepositorySchema, type CreateRepositoryInput } from "./common";
import { VisibilityField } from "./visibility-field";

export function NewRepositoryDialog({
  children,
  owners,
  defaultOwner,
}: {
  children: ReactNode;
  owners: string[];
  defaultOwner: string;
}) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateRepositoryInput>({
    resolver: zodResolver(createRepositorySchema),
    defaultValues: {
      owner: defaultOwner,
      name: "",
      description: "",
      visibility: "public",
    },
  });

  const { execute, isExecuting, result } = useAction(createRepository);

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a new repository</DialogTitle>
          <DialogDescription>
            A repository contains all project files, including the revision
            history.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(execute)} className="contents">
          <FieldGroup>
            <div className="flex items-start gap-2">
              <Field className="w-40 shrink-0">
                <FieldLabel htmlFor="repository-owner">Owner</FieldLabel>
                <Controller
                  control={control}
                  name="owner"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="repository-owner" className="w-full">
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

              <span className="pt-6 text-lg text-muted-foreground">/</span>

              <Field>
                <FieldLabel htmlFor="repository-name">
                  Repository name
                </FieldLabel>
                <Input
                  id="repository-name"
                  placeholder="my-project"
                  autoComplete="off"
                  aria-invalid={Boolean(errors.name)}
                  {...register("name")}
                />
                <FieldError errors={[errors.name]} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="repository-description">
                Description
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Textarea
                id="repository-description"
                placeholder="What is this project about?"
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
                <VisibilityField
                  id="repository-visibility"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />

            {result.serverError && (
              <FieldError>{result.serverError}</FieldError>
            )}
          </FieldGroup>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isExecuting}>
              {isExecuting && <Spinner />}
              Create repository
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
