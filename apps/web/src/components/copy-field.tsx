"use client";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/lib/use-copy";

/** A read-only value, such as a client ID, with a button that copies it. */
export function CopyField({
  id,
  label,
  value,
  description,
}: {
  id: string;
  label: string;
  value: string;
  description?: string;
}) {
  const { copied, copy } = useCopy(
    value,
    `Could not copy the ${label.toLowerCase()}.`,
  );

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input id={id} value={value} readOnly className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}
