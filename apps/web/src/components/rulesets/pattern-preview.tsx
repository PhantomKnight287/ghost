"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect } from "react";

import { BranchSelect } from "@/components/repositories/branch-select";
import { Spinner } from "@/components/ui/spinner";
import { patternLabel, type RulesetTarget } from "@/lib/rulesets";

import { previewRuleset } from "./actions";

// Long enough that typing a pattern sends one request, not one per key.
const DEBOUNCE_MS = 300;

/** The existing refs the patterns target, matched by the API with the same matcher enforcement uses. */
export function PatternPreview({
  username,
  repo,
  target,
  include,
  exclude,
}: {
  username: string;
  repo: string;
  target: RulesetTarget;
  include: string[];
  exclude: string[];
}) {
  const { execute, result, isExecuting } = useAction(previewRuleset);

  useEffect(() => {
    const timer = setTimeout(
      () => execute({ username, repo, patterns: { target, include, exclude } }),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [execute, username, repo, target, include, exclude]);

  const refs = result.data?.refs.map((ref) => patternLabel(target, ref)) ?? [];
  const noun = target === "branch" ? "branch" : "tag";
  const plural = target === "branch" ? "branches" : "tags";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      {isExecuting && <Spinner />}
      {result.serverError ? (
        <span>{result.serverError}</span>
      ) : (
        <span>
          Targets {refs.length} existing {refs.length === 1 ? noun : plural}
        </span>
      )}
      {refs.length > 0 && (
        <BranchSelect
          branches={refs}
          value=""
          onValueChange={() => {}}
          placeholder={`Browse targeted ${plural}`}
          searchPlaceholder={`Find a ${noun}`}
          emptyMessage={`No targeted ${noun} matches`}
          className="w-64"
        />
      )}
    </div>
  );
}
