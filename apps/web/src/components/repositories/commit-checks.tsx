import { cn } from "cn";
import { ChevronDown, CircleCheck, CircleDot, CircleX } from "lucide-react";
import type { components } from "@/lib/api/v1";

type CombinedCommitStatus = components["schemas"]["CombinedCommitStatusDTO"];
type CommitStatus = components["schemas"]["CommitStatusDTO"];

const stateLabel = {
  success: "Passed",
  failure: "Failed",
  error: "Errored",
  pending: "Pending",
} satisfies Record<CommitStatus["state"], string>;

export const statusTitle = {
  success: "All checks have passed",
  failure: "Some checks were not successful",
  error: "Some checks were not successful",
  pending: "Some checks haven't completed yet",
} satisfies Record<CombinedCommitStatus["state"], string>;

export function CommitStatusIcon({
  state,
  className,
}: {
  state: CommitStatus["state"];
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

/** A summary of the combined state that expands into every check, failing and pending first; open while any is not passing. */
export function CommitChecks({
  status,
  className,
}: {
  status: CombinedCommitStatus | null;
  className?: string;
}) {
  if (!status) return null;

  const count = (states: CommitStatus["state"][]) =>
    status.statuses.filter((s) => states.includes(s.state)).length;
  const summary = [
    [count(["failure", "error"]), "failing"],
    [count(["pending"]), "pending"],
    [count(["success"]), "successful"],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");
  const statuses = [
    ...status.statuses.filter((s) => s.state !== "success"),
    ...status.statuses.filter((s) => s.state === "success"),
  ];

  return (
    <details
      open={status.state !== "success"}
      className={cn("group rounded-md border px-3 py-2", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <CommitStatusIcon state={status.state} className="size-5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{statusTitle[status.state]}</p>
          <p className="text-xs text-muted-foreground">
            {summary} {status.statuses.length === 1 ? "check" : "checks"}
          </p>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 border-t pt-3">
        <CommitStatusRows statuses={statuses} />
      </div>
    </details>
  );
}
