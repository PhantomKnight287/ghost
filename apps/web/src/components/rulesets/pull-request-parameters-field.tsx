"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type MergeMethod,
  mergeMethods,
} from "@/components/pull-requests/common";
import { type PullRequestParameters, pullRequestFlags } from "@/lib/rulesets";

const methodLabels: Record<MergeMethod, string> = {
  merge: "Merge",
  squash: "Squash",
  rebase: "Rebase",
};

/** The `pull_request` rule's parameters, with GitHub's labels, shown under the rule once it is ticked. */
export function PullRequestParametersField({
  value,
  onChange,
}: {
  value: PullRequestParameters;
  onChange: (next: PullRequestParameters) => void;
}) {
  const methods = value.allowed_merge_methods;
  return (
    <div className="ml-7 flex flex-col gap-4 rounded-md border bg-muted/30 p-4">
      <Field>
        <FieldLabel htmlFor="pull-request-approvals">
          Required approvals
        </FieldLabel>
        <Input
          id="pull-request-approvals"
          type="number"
          min={0}
          max={10}
          className="w-24"
          value={value.required_approving_review_count}
          onChange={(event) =>
            onChange({
              ...value,
              required_approving_review_count: Math.min(
                10,
                Math.max(0, Math.trunc(Number(event.target.value) || 0)),
              ),
            })
          }
        />
        <FieldDescription>
          The number of approving reviews that are required before a pull
          request can be merged.
        </FieldDescription>
      </Field>

      {pullRequestFlags.map((flag) => (
        <label
          key={flag.key}
          htmlFor={`pull-request-${flag.key}`}
          className="flex items-start gap-3 text-sm"
        >
          <Checkbox
            id={`pull-request-${flag.key}`}
            className="mt-0.5"
            checked={value[flag.key]}
            onCheckedChange={(checked) =>
              onChange({ ...value, [flag.key]: checked === true })
            }
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{flag.title}</span>
            <FieldDescription>{flag.description}</FieldDescription>
          </span>
        </label>
      ))}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Allowed merge methods
        </legend>
        <FieldDescription>
          When merging pull requests, you can allow any combination of merge
          commits, squashing, or rebasing. At least one option must be enabled.
        </FieldDescription>
        <div className="flex flex-wrap gap-4">
          {mergeMethods.map((method) => (
            <label
              key={method}
              htmlFor={`pull-request-method-${method}`}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={`pull-request-method-${method}`}
                checked={methods.includes(method)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    allowed_merge_methods:
                      checked === true
                        ? mergeMethods.filter(
                            (option) =>
                              option === method || methods.includes(option),
                          )
                        : methods.filter((option) => option !== method),
                  })
                }
              />
              {methodLabels[method]}
            </label>
          ))}
        </div>
        {methods.length === 0 && (
          <FieldError>Allow at least one merge method.</FieldError>
        )}
      </fieldset>
    </div>
  );
}
