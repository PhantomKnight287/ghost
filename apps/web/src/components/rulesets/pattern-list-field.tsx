"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { patternLabel, type RulesetTarget } from "@/lib/rulesets";

/** Ref name patterns as removable chips, with one-click chips for `~DEFAULT_BRANCH` and `~ALL`. */
export function PatternListField({
  id,
  label,
  description,
  target,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  target: RulesetTarget;
  value: string[];
  onChange: (patterns: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = (pattern: string) => {
    const trimmed = pattern.trim();
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
  };
  const specials = target === "branch" ? ["~DEFAULT_BRANCH", "~ALL"] : ["~ALL"];

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldDescription>{description}</FieldDescription>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((pattern) => (
            <li key={pattern}>
              <Badge variant="secondary" className="gap-1 pr-1 font-mono">
                {patternLabel(target, pattern)}
                <button
                  type="button"
                  aria-label={`Remove ${patternLabel(target, pattern)}`}
                  className="rounded-sm hover:bg-muted-foreground/20"
                  onClick={() =>
                    onChange(value.filter((other) => other !== pattern))
                  }
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          className="font-mono"
          placeholder={
            target === "branch"
              ? "main, release/*, feature/**/*"
              : "v*, release-*"
          }
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add(draft);
            setDraft("");
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!draft.trim()}
          onClick={() => {
            add(draft);
            setDraft("");
          }}
        >
          <Plus />
          Add
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {specials
          .filter((special) => !value.includes(special))
          .map((special) => (
            <Button
              key={special}
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => add(special)}
            >
              <Plus />
              {patternLabel(target, special)}
            </Button>
          ))}
      </div>
    </Field>
  );
}
