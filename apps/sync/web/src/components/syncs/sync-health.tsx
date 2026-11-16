import type { Side, Sync } from "@/lib/api.ts";
import { ago } from "@/lib/time.ts";
import { StatusBadge } from "./status-badge.tsx";

/** How the sync is doing, why when it is not, and where to fix a missing app. */
export function SyncHealth({ sync, installUrl }: { sync: Sync; installUrl: Record<Side, string> }) {
  const missingApp = sync.disconnectReason?.match(/^(Ghost|GitHub) app/)?.[1];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={sync.status} />
        <span className="text-sm text-neutral-500">{sync.lastReconciledAt ? `Last caught up ${ago(sync.lastReconciledAt)}` : "First sync not finished yet"}</span>
      </div>
      {sync.status === "disconnected" && sync.disconnectReason && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Stopped: {sync.disconnectReason}.{" "}
          {missingApp && (
            <a href={installUrl[missingApp === "Ghost" ? "ghost" : "github"]} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              Install the app on {missingApp}
            </a>
          )}
          {sync.disconnectReason === "owner lost access" && " Regain admin on both repositories, then resume."}
        </p>
      )}
      {sync.status === "error" && sync.lastError && <p className="text-sm text-red-600">Last error: {sync.lastError}</p>}
    </div>
  );
}
