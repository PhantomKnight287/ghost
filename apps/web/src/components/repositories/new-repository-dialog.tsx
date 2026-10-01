"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useAction } from "next-safe-action/hooks";
import type { ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

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
import { apiClient, apiErrorMessage } from "@/lib/api/client";

import { createRepository, importRepository } from "./actions";
import { newRepositorySchema, type NewRepositoryInput } from "./common";
import { GitHubSourceField } from "./github-source-field";
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
    getValues,
    setValue,
    formState: { errors },
  } = useForm<NewRepositoryInput>({
    resolver: zodResolver(newRepositorySchema),
    defaultValues: {
      owner: defaultOwner,
      name: "",
      description: "",
      visibility: "public",
      source: "",
    },
  });

  const create = useAction(createRepository);
  const startImport = useAction(importRepository);
  const importing = Boolean(useWatch({ control, name: "source" }));
  const { isExecuting, result } = importing ? startImport : create;

  const { data: github } = useQuery({
    queryKey: ["github-import"],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/imports/github");
      if (error) throw new Error(apiErrorMessage(error));
      return data;
    },
  });

  // Organizations whose policy lets the viewer create repositories there, on top of the accounts the caller passed.
  const { data: organizations = [] } = useQuery({
    queryKey: ["my-organizations"],
    enabled: owners.length > 0,
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/organizations");
      if (error) throw new Error(apiErrorMessage(error));
      return data.organizations
        .filter((organization) => organization.canCreateRepositories)
        .map((organization) => organization.slug);
    },
  });
  const choices = [...new Set([...owners, ...organizations])];

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

        <form
          onSubmit={handleSubmit(({ source, ...input }) => {
            const organization = organizations.includes(input.owner)
              ? input.owner
              : undefined;
            if (source) startImport.execute({ ...input, source, organization });
            else create.execute({ ...input, organization });
          })}
          className="contents"
        >
          <FieldGroup>
            {github?.enabled && (
              <>
                <Controller
                  control={control}
                  name="source"
                  render={({ field }) => (
                    <GitHubSourceField
                      id="repository-source"
                      connected={github.connected}
                      error={errors.source}
                      value={field.value}
                      onChange={(source) => {
                        field.onChange(source);
                        // The GitHub name is the likeliest name here too.
                        const name = source.split("/")[1];
                        if (name && !getValues("name")) setValue("name", name);
                      }}
                    />
                  )}
                />
                <FieldSeparator />
              </>
            )}

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
                        {choices.map((owner) => (
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
              {importing ? "Import repository" : "Create repository"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
