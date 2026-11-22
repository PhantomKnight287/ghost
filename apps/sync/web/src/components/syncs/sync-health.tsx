import { HOST, type Side, type Sync } from "@/lib/api.ts";
import { ago, exactTime } from "@/lib/time.ts";
import { Callout } from "../ui/callout.tsx";
import { StatusBadge } from "./status-badge.tsx";

/** How the sync is doing, why when it is not, and where to fix a missing app. */
export function SyncHealth({ sync, installUrl }: { sync: Sync; installUrl: Record<Side, string> }) {
  const missingApp = (Object.keys(HOST) as Side[]).find((side) => sync.disconnectReason?.startsWith(`${HOST[side]} app`));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-zinc-500 dark:text-zinc-400">
        <StatusBadge status={sync.status} />
        <span title={sync.lastReconciledAt ? exactTime(sync.lastReconciledAt) : undefined}>{sync.lastReconciledAt ? `Caught up ${ago(sync.lastReconciledAt)}` : "First sync not finished yet"}</span>
        <span>Paired {exactTime(sync.createdAt)}</span>
      </div>
      {sync.status === "disconnected" && sync.disconnectReason && (
        <Callout tone="warning" title="Syncing stopped">
          <p>
            {sync.disconnectReason}.{" "}
            {missingApp && (
              <a href={installUrl[missingApp]} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                Install the app on {HOST[missingApp]}
              </a>
            )}
            {sync.disconnectReason === "owner lost access" && "Regain admin on both repositories, then resume."}
          </p>
        </Callout>
      )}
      {sync.status === "error" && sync.lastError && (
        <Callout tone="danger" title="The last sync failed">
          <p className="font-mono text-xs break-words">{sync.lastError}</p>
        </Callout>
      )}
    </div>
  );
}
