"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StatusCheckParameters } from "@/lib/rulesets";

const ANY_SOURCE = "any";

/** The `required_status_checks` rule's parameters, with GitHub's labels: contexts are typed freely, with the ones this repository has seen offered as suggestions. A check can be pinned to one of the apps installed on the repository, so only that app's status meets it. */
export function StatusCheckParametersField({
  value,
  onChange,
  suggestions,
  apps,
}: {
  value: StatusCheckParameters;
  onChange: (next: StatusCheckParameters) => void;
  suggestions: string[];
  apps: { appId: number; name: string }[];
}) {
  const pin = (context: string, source: string) =>
    onChange({
      ...value,
      required_status_checks: value.required_status_checks.map((check) =>
        check.context === context
          ? {
              context,
              ...(source !== ANY_SOURCE && { integration_id: Number(source) }),
            }
          : check,
      ),
    });
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
          <ul className="flex flex-col gap-2">
            {value.required_status_checks.map(({ context, integration_id }) => (
              <li
                key={context}
                className="flex flex-wrap items-center gap-2 rounded-md border bg-background py-1 pr-1 pl-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  {context}
                </span>
                {integration_id !== undefined &&
                  !apps.some(({ appId }) => appId === integration_id) && (
                    <span className="text-destructive">
                      App {integration_id} is not installed here or was deleted,
                      so this check cannot pass
                    </span>
                  )}
                <Select
                  value={
                    integration_id === undefined
                      ? ANY_SOURCE
                      : String(integration_id)
                  }
                  onValueChange={(source) => pin(context, source)}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 w-44"
                    aria-label={`Source of ${context}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_SOURCE}>Any source</SelectItem>
                    {integration_id !== undefined &&
                      !apps.some(({ appId }) => appId === integration_id) && (
                        <SelectItem value={String(integration_id)}>
                          App {integration_id}
                        </SelectItem>
                      )}
                    {apps.map(({ appId, name }) => (
                      <SelectItem key={appId} value={String(appId)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
