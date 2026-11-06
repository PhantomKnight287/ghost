import { cn } from "cn";
import { ChevronDown, CircleCheck, CircleDot, CircleX } from "lucide-react";

import { CheckRunRow } from "@/components/repositories/check-run-row";
import { Badge } from "@/components/ui/badge";
import type { components } from "@/lib/api/v1";

type CommitChecksDTO = components["schemas"]["CommitChecksDTO"];
type CommitStatus = components["schemas"]["CommitStatusDTO"];
type CheckRun = components["schemas"]["CheckRunDTO"];
type State = CommitChecksDTO["state"];

const stateLabel = {
  success: "Passed",
  failure: "Failed",
  error: "Errored",
  pending: "Pending",
} satisfies Record<State, string>;

export const statusTitle = {
  success: "All checks have passed",
  failure: "Some checks were not successful",
  error: "Some checks were not successful",
  pending: "Some checks haven't completed yet",
} satisfies Record<State, string>;

/** What a run counts as, as the API's rollup counts it: neutral and skipped pass. */
export function checkRunState(
  run: Pick<CheckRun, "status" | "conclusion">,
): State {
  if (run.status !== "completed" || !run.conclusion) return "pending";
  return ["success", "neutral", "skipped"].includes(run.conclusion)
    ? "success"
    : "failure";
}

export function CommitStatusIcon({
  state,
  className,
}: {
  state: State;
  className?: string;
}) {
  const icon = cn("size-4 shrink-0", className);
  return (
    <>
      {state === "success" ? (
        <CircleCheck className={cn(icon, "text-emerald-500")} />
      ) : state === "pending" ? (
        <CircleDot className={cn(icon, "text-amber-500")} />
      ) : (
        <CircleX className={cn(icon, "text-red-500")} />
      )}
      <span className="sr-only">{stateLabel[state]}</span>
    </>
  );
}

function StatusRow({
  status,
  required,
}: {
  status: CommitStatus;
  required: boolean;
}) {
  return (
    <li className="flex items-center gap-2">
      <CommitStatusIcon state={status.state} />
      <span className="shrink-0 font-medium">{status.context}</span>
      {required && (
        <Badge variant="outline" className="shrink-0">
          Required
        </Badge>
      )}
      {status.description && (
        <span
          title={status.description}
          className="min-w-0 truncate text-muted-foreground"
        >
          {status.description}
        </span>
      )}
      {status.targetUrl && (
        <a
          href={status.targetUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Details for ${status.context}`}
          className="ml-auto shrink-0 text-xs text-muted-foreground hover:underline"
        >
          Details
        </a>
      )}
    </li>
  );
}

/** Every check run and status of a commit, failing and pending first. Runs expand in place into their output; with `canRerun` (write access) they offer re-runs and their app's buttons. */
export function CommitCheckRows({
  checks,
  repository,
  required = [],
  canRerun = false,
}: {
  checks: CommitChecksDTO;
  repository: { username: string; repo: string };
  /** Contexts and run names a ruleset requires, badged as GitHub does. */
  required?: string[];
  canRerun?: boolean;
}) {
  const passing = (state: State) => state === "success";
  const rows = [
    ...checks.checkRuns.map((run) => ({
      key: run.id,
      state: checkRunState(run),
      run,
    })),
    ...checks.statuses.map((status) => ({
      key: status.id,
      state: status.state,
      status,
    })),
  ];
  const ordered = [
    ...rows.filter((row) => !passing(row.state)),
    ...rows.filter((row) => passing(row.state)),
  ];
  // "Re-run all" sits beside each app's first row.
  const firstOfApp = new Set([
    ...new Map(
      ordered.flatMap((row) =>
        "run" in row && row.run ? [[row.run.suiteId, row.key]] : [],
      ),
    ).values(),
  ]);

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {ordered.map((row) =>
        "run" in row && row.run ? (
          <CheckRunRow
            key={row.key}
            run={row.run}
            repository={repository}
            required={required.includes(row.run.name)}
            // A fork's run lives in the fork, where a writer here may have no say.
            canRerun={
              canRerun &&
              row.run.app.installed &&
              sameRepository(row.run.repository, repository)
            }
            rerunAll={firstOfApp.has(row.key)}
          />
        ) : (
          "status" in row &&
          row.status && (
            <StatusRow
              key={row.key}
              status={row.status}
              required={required.includes(row.status.context)}
            />
          )
        ),
      )}
    </ul>
  );
}

function sameRepository(
  a: { username: string; repo: string },
  b: { username: string; repo: string },
) {
  return (
    a.username.toLowerCase() === b.username.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

function summaryOf(checks: CommitChecksDTO) {
  const states = [
    ...checks.statuses.map((status) => status.state),
    ...checks.checkRuns.map(checkRunState),
  ];
  const count = (wanted: State[]) =>
    states.filter((state) => wanted.includes(state)).length;
  const summary = [
    [count(["failure", "error"]), "failing"],
    [count(["pending"]), "pending"],
    [count(["success"]), "successful"],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");
  return `${summary} ${states.length === 1 ? "check" : "checks"}`;
}

/** A summary of the combined state that expands into every check; open while any is not passing. */
export function CommitChecks({
  checks,
  repository,
  className,
  required = [],
  canRerun = false,
}: {
  checks: CommitChecksDTO | null;
  repository: { username: string; repo: string };
  className?: string;
  required?: string[];
  canRerun?: boolean;
}) {
  if (!checks) return null;

  return (
    <details
      open={checks.state !== "success"}
      className={cn("group rounded-md border px-3 py-2", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <CommitStatusIcon state={checks.state} className="size-5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{statusTitle[checks.state]}</p>
          <p className="text-xs text-muted-foreground">{summaryOf(checks)}</p>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 border-t pt-3">
        <CommitCheckRows
          checks={checks}
          repository={repository}
          required={required}
          canRerun={canRerun}
        />
      </div>
    </details>
  );
}
