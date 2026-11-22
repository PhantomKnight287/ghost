import { Link } from "@tanstack/react-router";
import type { Sync } from "@/lib/api.ts";
import { ago, exactTime } from "@/lib/time.ts";
import { buttonClass } from "../ui/button.tsx";
import { AlertIcon, PlusIcon, SyncIcon } from "../ui/icons.tsx";
import { Panel } from "../ui/panel.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { RepositoryPair } from "./repository-pair.tsx";
import { StatusBadge } from "./status-badge.tsx";

const COLUMNS = "sm:grid-cols-[minmax(0,1fr)_10rem_8rem]";

/** The dashboard's list: each sync as its two repositories, its health and when it last caught up. */
export function SyncTable({ syncs }: { syncs: Sync[] }) {
  if (syncs.length === 0) {
    return (
      <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          <SyncIcon />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-medium">No syncs yet</p>
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">Pair a Ghost repository with a GitHub repository to keep them in step both ways.</p>
        </div>
        <Link to="/new" className={`${buttonClass()} mt-2`}>
          <PlusIcon /> New sync
        </Link>
      </Panel>
    );
  }
  return (
    <Panel className="overflow-hidden">
      <div className={`hidden gap-6 border-b border-zinc-200 bg-zinc-50 px-5 py-2.5 text-xs font-medium text-zinc-500 sm:grid dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 ${COLUMNS}`}>
        <span>Repositories</span>
        <span>Status</span>
        <span className="text-right">Last caught up</span>
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {syncs.map((sync) => {
          const problem = sync.status === "disconnected" ? sync.disconnectReason : sync.status === "error" ? sync.lastError : null;
          return (
            <li key={sync.id}>
              <Link to="/syncs/$id" params={{ id: sync.id }} className={`grid gap-3 px-5 py-4 transition-colors hover:bg-zinc-50 sm:items-center sm:gap-6 dark:hover:bg-zinc-800/40 ${COLUMNS}`}>
                <div className="flex min-w-0 flex-col gap-2">
                  <RepositoryPair ghost={sync.ghostFullName} github={sync.githubFullName} />
                  {problem && (
                    <p className="flex items-center gap-1.5 text-[13px] text-amber-700 dark:text-amber-400">
                      <AlertIcon width={14} height={14} className="shrink-0" />
                      <span className="truncate">{problem}</span>
                    </p>
                  )}
                </div>
                <StatusBadge status={sync.status} />
                <span className="text-[13px] text-zinc-500 sm:text-right dark:text-zinc-400" title={sync.lastReconciledAt ? exactTime(sync.lastReconciledAt) : undefined}>
                  {sync.lastReconciledAt ? ago(sync.lastReconciledAt) : "Not yet"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function SyncTableSkeleton() {
  return (
    <Panel className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className={`grid gap-3 px-5 py-4 sm:items-center sm:gap-6 ${COLUMNS}`}>
          <div className="flex gap-6">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20 sm:ml-auto" />
        </div>
      ))}
    </Panel>
  );
}
