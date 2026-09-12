"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

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
import { type CreateLabelInput, createLabelSchema } from "./common";

const DEFAULT_COLOR = "d73a4a";

/**
 * Create and edit share every field, so both go through this form. Colors are
 * stored as 6 hex chars; the native picker is the only place `#` appears.
 */
export function LabelForm({
  id,
  label,
  submitText,
  pending,
  onSubmit,
  onCancel,
}: {
  id: string;
  label?: IssueLabel;
  submitText: string;
  pending: boolean;
  onSubmit: (values: CreateLabelInput) => void;
  onCancel: () => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateLabelInput>({
    resolver: zodResolver(createLabelSchema),
    defaultValues: {
      name: label?.name ?? "",
      description: label?.description ?? "",
      color: label?.color ?? DEFAULT_COLOR,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            placeholder="bug"
            autoComplete="off"
            maxLength={50}
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field>
          <FieldLabel htmlFor={`${id}-description`}>
            Description
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </FieldLabel>
          <Input
            id={`${id}-description`}
            placeholder="Something is not working"
            autoComplete="off"
            maxLength={100}
            aria-invalid={Boolean(errors.description)}
            {...register("description")}
          />
          <FieldError errors={[errors.description]} />
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor={`${id}-color`}>Color</FieldLabel>
          <Controller
            control={control}
            name="color"
            render={({ field }) => (
              <input
                id={`${id}-color`}
                type="color"
                className="h-9 w-14 cursor-pointer rounded-md border bg-transparent p-1"
                ref={field.ref}
                value={`#${field.value}`}
                onBlur={field.onBlur}
                onChange={(event) =>
                  field.onChange(event.target.value.slice(1))
                }
              />
            )}
          />
          <FieldError errors={[errors.color]} />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending && <Spinner />}
            {submitText}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
