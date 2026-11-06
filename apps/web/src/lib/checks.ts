import type { components } from "@/lib/api/v1";

type CommitChecks = components["schemas"]["CommitChecksDTO"];
type CheckRun = components["schemas"]["CheckRunDTO"];
type CommitStatus = components["schemas"]["CommitStatusDTO"];
type State = CommitChecks["state"];

export type CheckRow =
  | { kind: "run"; key: string; state: State; run: CheckRun; rerunAll: boolean }
  | { kind: "status"; key: string; state: State; status: CommitStatus };

/** What a run counts as, as the API's rollup counts it: neutral and skipped pass. */
export function checkRunState(
  run: Pick<CheckRun, "status" | "conclusion">,
): State {
  if (run.status !== "completed" || !run.conclusion) return "pending";
  return ["success", "neutral", "skipped"].includes(run.conclusion)
    ? "success"
    : "failure";
}

const rank = { failure: 0, error: 0, pending: 1, success: 2 } satisfies Record<
  State,
  number
>;

/** A commit's runs and statuses together, failing first, then pending, then passing; each app's first run offers "Re-run all" for its suite. */
export function orderCheckRows(checks: CommitChecks): CheckRow[] {
  const rows: CheckRow[] = [
    ...checks.checkRuns.map((run) => ({
      kind: "run" as const,
      key: run.id,
      state: checkRunState(run),
      run,
      rerunAll: false,
    })),
    ...checks.statuses.map((status) => ({
      kind: "status" as const,
      key: status.id,
      state: status.state,
      status,
    })),
  ].sort((a, b) => rank[a.state] - rank[b.state]);
  const suites = new Set<string>();
  for (const row of rows)
    if (row.kind === "run" && !suites.has(row.run.suiteId)) {
      suites.add(row.run.suiteId);
      row.rerunAll = true;
    }
  return rows;
}
