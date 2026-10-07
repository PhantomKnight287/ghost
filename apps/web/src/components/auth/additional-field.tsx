"use client";

import type {
  AdditionalField as AdditionalFieldConfig,
  AdditionalFieldFormValue,
} from "@better-auth-ui/core";
import type { ComponentType } from "react";

export type AdditionalFieldProps = {
  name: string;
  field: AdditionalFieldConfig;
  value: AdditionalFieldFormValue;
  onBlur: () => void;
  onChange: (value: AdditionalFieldFormValue) => void;
  isInvalid?: boolean;
  errors?: unknown[];
  isPending?: boolean;
  /** Complete suffix appended to labels for fields that are not required. */
  optionalLabel?: string;
};

/** Renders an additional user field through the renderer its plugin registers; `username` is the only one configured. */
export function AdditionalField(props: AdditionalFieldProps) {
  const { field, name, optionalLabel } = props;
  if (!field.render) {
    throw new Error(
      `Additional field "${name}" has no renderer; register one in its auth plugin.`,
    );
  }
  const FieldRenderer = field.render as ComponentType<AdditionalFieldProps>;
  const label =
    optionalLabel && !field.required ? (
      <>
        {field.label}
        {optionalLabel}
      </>
    ) : (
      field.label
    );

  return <FieldRenderer {...props} field={{ ...field, label }} />;
}
