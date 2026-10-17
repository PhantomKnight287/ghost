import { ChevronRight, CircleCheck, CircleDot, CircleX } from "lucide-react";
import type { components } from "@/lib/api/v1";

type CombinedCommitStatus = components["schemas"]["CombinedCommitStatusDTO"];
type CommitStatus = components["schemas"]["CommitStatusDTO"];

const stateLabel = {
  success: "Passed",
  failure: "Failed",
  error: "Errored",
  pending: "Pending",
} satisfies Record<CommitStatus["state"], string>;

export function CommitStatusIcon({ state }: { state: CommitStatus["state"] }) {
  return (
    <>
      {state === "success" ? (
        <CircleCheck className="size-4 shrink-0 text-emerald-500" />
      ) : state === "pending" ? (
        <CircleDot className="size-4 shrink-0 text-amber-500" />
      ) : (
        <CircleX className="size-4 shrink-0 text-red-500" />
      )}
      <span className="sr-only">{stateLabel[state]}</span>
    </>
  );
}

export function CommitStatusRows({ statuses }: { statuses: CommitStatus[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {statuses.map((status) => (
        <li key={status.id} className="flex items-center gap-2">
          <CommitStatusIcon state={status.state} />
          <span className="shrink-0 font-medium">{status.context}</span>
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
      ))}
    </ul>
  );
}

/** Failing and pending checks each get a row; passing ones fold into one line that expands into the same rows. */
export function CommitChecks({
  status,
}: {
  status: CombinedCommitStatus | null;
}) {
  if (!status) return null;

  const problems = status.statuses.filter((s) => s.state !== "success");
  const passing = status.statuses.filter((s) => s.state === "success");

  return (
    <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
      {problems.length > 0 && <CommitStatusRows statuses={problems} />}
      {passing.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
            <CommitStatusIcon state="success" />
            {passing.length} successful{" "}
            {passing.length === 1 ? "check" : "checks"}
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-2">
            <CommitStatusRows statuses={passing} />
          </div>
        </details>
      )}
    </div>
  );
}
