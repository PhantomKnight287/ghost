"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { createBranch } from "@/components/repositories/actions";
import {
  type CreateBranchInput,
  createBranchSchema,
} from "@/components/repositories/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
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

export function CreateBranchDialog({
  username,
  repo,
  branches,
  defaultBranch,
}: {
  username: string;
  repo: string;
  branches: string[];
  defaultBranch: string;
}) {
  const [open, setOpen] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateBranchInput>({
    resolver: zodResolver(createBranchSchema),
    defaultValues: { name: "", from: defaultBranch },
  });

  const { execute, isExecuting, result } = useAction(createBranch, {
    onSuccess: () => {
      setOpen(false);
      reset({ name: "", from: defaultBranch });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="ml-auto">
          <Plus data-icon="inline-start" />
          New branch
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a branch</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((input) =>
            execute({ ...input, username, slug: repo }),
          )}
          className="contents"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="branch-name">New branch name</FieldLabel>
              <Input
                id="branch-name"
                placeholder="feat/my-change"
                autoComplete="off"
                aria-invalid={Boolean(errors.name)}
                {...register("name")}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="branch-from">Source</FieldLabel>
              <Controller
                control={control}
                name="from"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="branch-from" className="w-full">
                      <SelectValue />
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
            </Field>

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
              Create branch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
