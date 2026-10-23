"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { StatusCheckParameters } from "@/lib/rulesets";

/** The `required_status_checks` rule's parameters, with GitHub's labels: contexts are typed freely, with the ones this repository has seen offered as suggestions. */
export function StatusCheckParametersField({
  value,
  onChange,
  suggestions,
}: {
  value: StatusCheckParameters;
  onChange: (next: StatusCheckParameters) => void;
  suggestions: string[];
}) {
  const listId = useId();
  const [draft, setDraft] = useState("");
  const chosen = value.required_status_checks.map(({ context }) => context);
  const add = () => {
    const context = draft.trim();
    setDraft("");
    if (!context || chosen.includes(context)) return;
    onChange({
      ...value,
      required_status_checks: [...value.required_status_checks, { context }],
    });
  };
  const flags = [
    {
      key: "strict_required_status_checks_policy",
      title: "Require branches to be up to date before merging",
      description:
        "Whether pull requests targeting a matching branch must be tested with the latest code.",
    },
    {
      key: "do_not_enforce_on_create",
      title: "Do not require status checks on creation",
      description:
        "Allow repositories and branches to be created if a check would otherwise prohibit it.",
    },
  ] as const;

  return (
    <div className="ml-7 flex flex-col gap-4 rounded-md border bg-muted/30 p-4">
      {flags.map((flag) => (
        <label
          key={flag.key}
          htmlFor={`status-checks-${flag.key}`}
          className="flex items-start gap-3 text-sm"
        >
          <Checkbox
            id={`status-checks-${flag.key}`}
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
      <Field>
        <FieldLabel htmlFor="status-checks-context">Status checks</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="status-checks-context"
            list={listId}
            placeholder="Add a check, such as build"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              add();
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={add}
            disabled={!draft.trim()}
          >
            Add
          </Button>
        </div>
        <datalist id={listId}>
          {suggestions
            .filter((context) => !chosen.includes(context))
            .map((context) => (
              <option key={context} value={context} />
            ))}
        </datalist>
        <FieldDescription>
          Each check must report success on the commit. Suggestions are the
          checks this repository has seen.
        </FieldDescription>
        {chosen.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {chosen.map((context) => (
              <li
                key={context}
                className="flex items-center gap-1 rounded-md border bg-background py-0.5 pr-1 pl-2 font-mono text-xs"
              >
                {context}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-5"
                  aria-label={`Remove ${context}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      required_status_checks:
                        value.required_status_checks.filter(
                          (check) => check.context !== context,
                        ),
                    })
                  }
                >
                  <X className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Field>
    </div>
  );
}
