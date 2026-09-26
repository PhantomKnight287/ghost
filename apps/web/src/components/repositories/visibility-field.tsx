import { BookLock, Globe } from "lucide-react";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import type { repositoryVisibilities } from "./common";

type Visibility = (typeof repositoryVisibilities)[number];

export function VisibilityField({
  id,
  value,
  onChange,
}: {
  /** Prefix for the radio ids, unique per form on the page. */
  id: string;
  value: Visibility;
  onChange: (value: Visibility) => void;
}) {
  return (
    <RadioGroup value={value} onValueChange={onChange}>
      <FieldLabel htmlFor={`${id}-public`}>
        <Field orientation="horizontal">
          <Globe className="size-5 text-muted-foreground" />
          <FieldContent>
            <FieldTitle>Public</FieldTitle>
            <FieldDescription>
              Anyone on the internet can see this repository.
            </FieldDescription>
          </FieldContent>
          <RadioGroupItem value="public" id={`${id}-public`} />
        </Field>
      </FieldLabel>

      <FieldLabel htmlFor={`${id}-private`}>
        <Field orientation="horizontal">
          <BookLock className="size-5 text-muted-foreground" />
          <FieldContent>
            <FieldTitle>Private</FieldTitle>
            <FieldDescription>
              You choose who can see and commit to this repository.
            </FieldDescription>
          </FieldContent>
          <RadioGroupItem value="private" id={`${id}-private`} />
        </Field>
      </FieldLabel>
    </RadioGroup>
  );
}
