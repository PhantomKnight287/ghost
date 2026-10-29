"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { RoleSelect } from "@/components/role-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  type BypassActor,
  defaultPullRequestParameters,
  defaultStatusCheckParameters,
  type PullRequestParameters,
  type Ruleset,
  type RulesetTarget,
  type RuleType,
  rules as allRules,
  type StatusCheckParameters,
} from "@/lib/rulesets";

import { createRuleset, updateRuleset } from "./actions";
import { BypassActorsField } from "./bypass-actors-field";
import { PatternListField } from "./pattern-list-field";
import { PatternPreview } from "./pattern-preview";
import { PullRequestParametersField } from "./pull-request-parameters-field";
import { StatusCheckParametersField } from "./status-check-parameters-field";

const targets = ["branch", "tag"] as const;
const targetLabels = { branch: "Branch", tag: "Tag" };
const enforcements = ["active", "evaluate", "disabled"] as const;
const enforcementLabels = {
  active: "Active",
  evaluate: "Evaluate",
  disabled: "Disabled",
};

// The form edits patterns as typed, without the prefix: the API adds the one the target implies, so switching the target carries them over.
const unprefixed = (pattern: string) =>
  pattern.replace(/^refs\/(heads|tags)\//, "");

/** Creates a ruleset, or with `ruleset` edits one; an edit replaces the whole ruleset. */
export function RulesetForm({
  username,
  repo,
  teams,
  apps,
  ruleset,
  statusContexts,
}: {
  username: string;
  repo: string;
  /** Null on a personal repository. */
  teams: { id: string; name: string }[] | null;
  /** Apps installed on the repository, for pinning checks and bypassing. */
  apps: { appId: number; name: string }[];
  ruleset?: Ruleset;
  /** Contexts this repository's statuses have named, suggested as required checks. */
  statusContexts: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(ruleset?.name ?? "");
  const [target, setTarget] = useState<RulesetTarget>(
    ruleset?.target ?? "branch",
  );
  const [enforcement, setEnforcement] = useState(
    ruleset?.enforcement ?? "active",
  );
  const [include, setInclude] = useState(
    ruleset?.include.map(unprefixed) ?? [],
  );
  const [exclude, setExclude] = useState(
    ruleset?.exclude.map(unprefixed) ?? [],
  );
  const [bypassActors, setBypassActors] = useState<BypassActor[]>(
    ruleset?.bypassActors ?? [],
  );
  const [rules, setRules] = useState<RuleType[]>(
    ruleset?.rules.map(({ type }) => type) ?? [],
  );
  const [pullRequest, setPullRequest] = useState<PullRequestParameters>(
    () =>
      ({
        ...defaultPullRequestParameters,
        ...ruleset?.rules.find(({ type }) => type === "pull_request")
          ?.parameters,
      }) as PullRequestParameters,
  );

  const [statusChecks, setStatusChecks] = useState<StatusCheckParameters>(
    () =>
      ({
        ...defaultStatusCheckParameters,
        ...ruleset?.rules.find(({ type }) => type === "required_status_checks")
          ?.parameters,
      }) as StatusCheckParameters,
  );

  const onError = ({ error }: { error: { serverError?: string } }) =>
    toast.error(error.serverError ?? "Could not save this ruleset.");
  const create = useAction(createRuleset, { onError });
  const update = useAction(updateRuleset, {
    onSuccess: () => {
      toast.success("Ruleset saved");
      router.refresh();
    },
    onError,
  });
  const pending = create.isExecuting || update.isExecuting;
  const serverError = create.result.serverError ?? update.result.serverError;

  const save = () => {
    const body = {
      name: name.trim(),
      target,
      enforcement,
      include,
      exclude,
      bypassActors,
      rules: rules.map((type) =>
        type === "pull_request"
          ? { type, parameters: pullRequest }
          : type === "required_status_checks"
            ? { type, parameters: statusChecks }
            : { type },
      ),
    };
    if (ruleset) update.execute({ username, repo, id: ruleset.id, body });
    else create.execute({ username, repo, body });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Card className="gap-0 py-0">
        <CardContent className="flex flex-col gap-8 py-6">
          <div className="grid gap-5 sm:grid-cols-[1fr_auto_auto]">
            <Field>
              <FieldLabel htmlFor="ruleset-name">Name</FieldLabel>
              <Input
                id="ruleset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ruleset-target">Target</FieldLabel>
              <RoleSelect
                id="ruleset-target"
                roles={targets}
                labels={targetLabels}
                value={target}
                onChange={(next) => {
                  setTarget(next);
                  // Only branches have a default.
                  if (next === "tag") {
                    setInclude(
                      include.filter(
                        (pattern) => pattern !== "~DEFAULT_BRANCH",
                      ),
                    );
                    setExclude(
                      exclude.filter(
                        (pattern) => pattern !== "~DEFAULT_BRANCH",
                      ),
                    );
                  }
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ruleset-enforcement">Enforcement</FieldLabel>
              <RoleSelect
                id="ruleset-enforcement"
                roles={enforcements}
                labels={enforcementLabels}
                value={enforcement}
                onChange={setEnforcement}
              />
              {enforcement === "evaluate" && (
                <FieldDescription>
                  Records what would pass or fail without blocking anything.
                </FieldDescription>
              )}
            </Field>
          </div>

          <section className="flex flex-col gap-5">
            <h3 className="text-sm font-semibold">Targets</h3>
            <PatternListField
              id="ruleset-include"
              label="Include"
              description="Refs matching any of these are targeted. `*` stays within one path segment; `**` crosses them."
              target={target}
              value={include}
              onChange={setInclude}
            />
            <PatternListField
              id="ruleset-exclude"
              label="Exclude"
              description="Refs matching any of these are left out, whatever Include says."
              target={target}
              value={exclude}
              onChange={setExclude}
            />
            <PatternPreview
              username={username}
              repo={repo}
              target={target}
              include={include}
              exclude={exclude}
            />
          </section>

          <BypassActorsField
            value={bypassActors}
            onChange={setBypassActors}
            teams={teams}
            apps={apps}
          />

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 text-sm font-semibold">Rules</legend>
            {allRules.map((rule) => (
              <div key={rule.type} className="flex flex-col gap-3">
                <label
                  htmlFor={`rule-${rule.type}`}
                  className="flex items-start gap-3 text-sm"
                >
                  <Checkbox
                    id={`rule-${rule.type}`}
                    className="mt-0.5"
                    checked={rules.includes(rule.type)}
                    onCheckedChange={(checked) =>
                      setRules(
                        checked === true
                          ? [...rules, rule.type]
                          : rules.filter((type) => type !== rule.type),
                      )
                    }
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{rule.title}</span>
                    <FieldDescription>{rule.description}</FieldDescription>
                  </span>
                </label>
                {rule.type === "pull_request" &&
                  rules.includes("pull_request") && (
                    <PullRequestParametersField
                      value={pullRequest}
                      onChange={setPullRequest}
                    />
                  )}
                {rule.type === "required_status_checks" &&
                  rules.includes("required_status_checks") && (
                    <StatusCheckParametersField
                      value={statusChecks}
                      onChange={setStatusChecks}
                      suggestions={statusContexts}
                      apps={apps}
                    />
                  )}
              </div>
            ))}
          </fieldset>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
          {serverError ? <FieldError>{serverError}</FieldError> : <span />}
          <Button
            type="submit"
            size="sm"
            disabled={
              pending ||
              !name.trim() ||
              (rules.includes("pull_request") &&
                pullRequest.allowed_merge_methods.length === 0) ||
              (rules.includes("required_status_checks") &&
                statusChecks.required_status_checks.length === 0)
            }
          >
            {pending && <Spinner />}
            {ruleset ? "Save changes" : "Create ruleset"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function RulesetFormSkeleton() {
  return (
    <div className="flex flex-col gap-8 rounded-xl border p-6">
      <div className="grid gap-5 sm:grid-cols-[1fr_auto_auto]">
        <Skeleton className="h-14" />
        <Skeleton className="h-14 w-32" />
        <Skeleton className="h-14 w-32" />
      </div>
      <Skeleton className="h-28" />
      <Skeleton className="h-20" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-9" />
        ))}
      </div>
    </div>
  );
}
