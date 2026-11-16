import { Link } from "@tanstack/react-router";
import type { Sync } from "@/lib/api.ts";
import { ago } from "@/lib/time.ts";
import { buttonClass } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { StatusBadge } from "./status-badge.tsx";

/** The dashboard's list: each sync as its two repositories, its health and when it last caught up. */
export function SyncTable({ syncs }: { syncs: Sync[] }) {
  if (syncs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
        <p className="text-neutral-500">No syncs yet. Pair a Ghost repository with a GitHub one to keep them in step both ways.</p>
        <Link to="/new" className={`${buttonClass()} mt-4`}>
          + New sync
        </Link>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
      {syncs.map((sync) => (
        <li key={sync.id}>
          <Link to="/syncs/$id" params={{ id: sync.id }} className="grid gap-1 px-4 py-3 hover:bg-neutral-50 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center sm:gap-4 dark:hover:bg-neutral-900">
            <span className="truncate font-medium">{sync.ghostFullName}</span>
            <span className="truncate text-neutral-500">{sync.githubFullName}</span>
            <StatusBadge status={sync.status} />
            <span className="text-sm text-neutral-500">{sync.lastReconciledAt ? `Synced ${ago(sync.lastReconciledAt)}` : "Not synced yet"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SyncTableSkeleton() {
  return (
    <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="grid gap-2 px-4 py-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:gap-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
