"use client";

import { useQuery } from "@tanstack/react-query";
import { type Control, Controller } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient, unwrap } from "@/lib/api/client";

import { BranchSelect } from "./branch-select";
import type { NewRepositoryInput } from "./common";

// The pickers need a value for "no template"; the form stores it as an empty name.
const NONE = "None";

/** The README, .gitignore and license a new repository starts with, as one first commit. */
export function InitialFilesFields({
  control,
}: {
  control: Control<NewRepositoryInput>;
}) {
  const { data: templates } = useQuery({
    queryKey: ["repository-templates"],
    queryFn: () => unwrap(apiClient.GET("/api/repository-templates")),
    staleTime: Number.POSITIVE_INFINITY,
  });

  return (
    <>
      <Controller
        control={control}
        name="readme"
        render={({ field }) => (
          <Field orientation="horizontal">
            <Checkbox
              id="repository-readme"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
            <FieldLabel htmlFor="repository-readme" className="font-normal">
              Add a README
            </FieldLabel>
          </Field>
        )}
      />

      <div className="flex gap-2">
        <Field>
          <FieldLabel htmlFor="repository-gitignore">.gitignore</FieldLabel>
          <Controller
            control={control}
            name="gitignoreTemplate"
            render={({ field }) => (
              <BranchSelect
                id="repository-gitignore"
                branches={[NONE, ...(templates?.gitignore ?? [])]}
                value={field.value || NONE}
                onValueChange={(name) =>
                  field.onChange(name === NONE ? "" : name)
                }
                searchPlaceholder="Find a template"
                emptyMessage="No template matches"
                className="w-full"
              />
            )}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="repository-license">License</FieldLabel>
          <Controller
            control={control}
            name="licenseTemplate"
            render={({ field }) => (
              <Select
                value={field.value || NONE}
                onValueChange={(key) => field.onChange(key === NONE ? "" : key)}
              >
                <SelectTrigger id="repository-license" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{NONE}</SelectItem>
                  {templates?.licenses.map((license) => (
                    <SelectItem key={license.key} value={license.key}>
                      {license.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>
    </>
  );
}
