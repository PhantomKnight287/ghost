"use client";

import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import {
  Check,
  ChevronRight,
  CircleCheck,
  CircleX,
  ShieldAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useState, useSyncExternalStore } from "react";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { UserLink } from "@/components/users/user-link";
import type { components } from "@/lib/api/v1";

import { loadRuleSuites } from "./actions";
import type { RuleSuiteQuery } from "./rule-suite-filters";

dayjs.extend(utc);
dayjs.extend(timezone);

type RuleSuite = components["schemas"]["RuleSuiteDTO"];
type RuleSuitePage = components["schemas"]["ListRuleSuitesResponseDTO"];

const subscribeToNothing = () => () => {};
const readTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const RESULTS = {
  pass: { label: "Passed", icon: CircleCheck, className: "text-green-600" },
  fail: { label: "Failed", icon: CircleX, className: "text-destructive" },
  bypass: { label: "Bypassed", icon: ShieldAlert, className: "text-amber-600" },
};

/** Suites grouped by the viewer's day, each opening in place onto the rules it checked. Later pages append, so a day spanning two pages stays one group. */
export function RuleSuiteTimeline({
  username,
  repo,
  query,
  limit,
  first,
}: {
  username: string;
  repo: string;
  query: RuleSuiteQuery;
  limit: number;
  first: RuleSuitePage;
}) {
  const [{ ruleSuites: suites, nextCursor }, setLoaded] = useState(first);
  const more = useAction(loadRuleSuites, {
    onSuccess: ({ data }) =>
      data &&
      setLoaded((loaded) => ({
        ruleSuites: [...loaded.ruleSuites, ...data.ruleSuites],
        nextCursor: data.nextCursor,
      })),
  });
  // The server has no timezone to group by, so it groups in UTC and the client regroups on hydration.
  const tz = useSyncExternalStore(
    subscribeToNothing,
    readTimezone,
    () => "UTC",
  );

  if (suites.length === 0)
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>No rule evaluations</EmptyTitle>
          <EmptyDescription>
            Pushes and merges the rulesets check show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  const today = dayjs().tz(tz).startOf("day");
  const days = new Map<string, RuleSuite[]>();
  for (const suite of suites) {
    const day = dayjs(suite.createdAt).tz(tz).startOf("day");
    const label = day.isSame(today)
      ? "Today"
      : day.isSame(today.subtract(1, "day"))
        ? "Yesterday"
        : day.format("MMM D, YYYY");
    days.set(label, [...(days.get(label) ?? []), suite]);
  }

  return (
    <div className="flex flex-col gap-4">
      {[...days].map(([day, daySuites]) => (
        <section key={day}>
          <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {day}
          </h3>
          <ul className="divide-y rounded-lg border">
            {daySuites.map((suite) => (
              <li key={suite.id}>
                <RuleSuiteRow username={username} repo={repo} suite={suite} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {nextCursor && (
        <Button
          variant="outline"
          className="self-center"
          disabled={more.isExecuting}
          onClick={() =>
            more.execute({ username, repo, query, cursor: nextCursor, limit })
          }
        >
          {more.isExecuting && <Spinner />}
          Load more
        </Button>
      )}
    </div>
  );
}

function RuleSuiteRow({
  username,
  repo,
  suite,
}: {
  username: string;
  repo: string;
  suite: RuleSuite;
}) {
  const result = RESULTS[suite.result];
  const Icon = result.icon;
  const rulesets = new Map<string, RuleSuite["evaluations"]>();
  for (const evaluation of suite.evaluations) {
    const key = evaluation.rulesetId ?? `deleted:${evaluation.rulesetName}`;
    rulesets.set(key, [...(rulesets.get(key) ?? []), evaluation]);
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <Icon className={`size-4 shrink-0 ${result.className}`} />
        <UserLink username={suite.actor?.username ?? suite.actorName ?? ""} />
        <span className="text-muted-foreground">
          {suite.pullRequest ? (
            <>
              merged{" "}
              <Link
                href={`/${username}/${repo}/pull/${suite.pullRequest.number}`}
                className="hover:underline"
              >
                #{suite.pullRequest.number}
              </Link>{" "}
              into
            </>
          ) : (
            "pushed to"
          )}
        </span>
        <code className="font-mono text-xs">
          {suite.ref.replace(/^refs\/(heads|tags)\//, "")}
        </code>
        <code className="font-mono text-xs text-muted-foreground">
          {suite.beforeSha.slice(0, 7)} → {suite.afterSha.slice(0, 7)}
        </code>
        <Badge variant="outline">{result.label}</Badge>
        {suite.result === "pass" && suite.evaluationResult === "fail" && (
          <Badge variant="secondary">evaluate: would fail</Badge>
        )}
        <FromNowHoverCard
          date={suite.createdAt}
          className="ml-auto text-xs text-muted-foreground"
        />
      </summary>
      <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 pl-10">
        {[...rulesets].map(([key, evaluations]) => (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              {evaluations[0].rulesetName}
              {evaluations[0].enforcement === "evaluate" && (
                <Badge variant="secondary">evaluate</Badge>
              )}
              {evaluations[0].enforcement === "deleted ruleset" && (
                <Badge variant="outline">deleted</Badge>
              )}
            </div>
            <ul className="flex flex-col gap-1">
              {evaluations.map((evaluation) => (
                <li key={evaluation.rule} className="flex gap-2 text-sm">
                  {evaluation.result === "pass" ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-green-600" />
                  ) : (
                    <X className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="flex flex-col">
                    <code className="font-mono text-xs">{evaluation.rule}</code>
                    {evaluation.details && (
                      <span className="whitespace-pre-line text-muted-foreground">
                        {evaluation.details}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
