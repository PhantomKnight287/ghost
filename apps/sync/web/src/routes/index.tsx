import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header.tsx";
import { SignedIn } from "@/components/layout/signed-in.tsx";
import { SyncTable, SyncTableSkeleton } from "@/components/syncs/sync-table.tsx";
import { buttonClass } from "@/components/ui/button.tsx";
import { Callout } from "@/components/ui/callout.tsx";
import { PlusIcon } from "@/components/ui/icons.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, type Sync } from "@/lib/api.ts";

// The API's session cookie never reaches a server render, so pages render in the browser.
export const Route = createFileRoute("/")({ ssr: false, component: DashboardPage });

function DashboardPage() {
  return (
    <SignedIn>
      <Dashboard />
    </SignedIn>
  );
}

function Dashboard() {
  const syncs = useQuery({ queryKey: ["syncs"], queryFn: () => api<{ syncs: Sync[] }>("/api/syncs"), refetchInterval: 30_000 });
  const list = syncs.data?.syncs;
  const attention = list?.filter((sync) => sync.status === "disconnected" || sync.status === "error").length ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Syncs"
        description={
          list ? (
            <>
              {list.length} {list.length === 1 ? "pair" : "pairs"} of repositories
              {attention > 0 && <span className="text-amber-700 dark:text-amber-400"> · {attention} need attention</span>}
            </>
          ) : (
            <Skeleton className="h-4 w-44" />
          )
        }
        actions={
          list?.length ? (
            <Link to="/new" className={buttonClass()}>
              <PlusIcon /> New sync
            </Link>
          ) : null
        }
      />
      {syncs.error ? <Callout tone="danger" title="Your syncs could not be loaded">{syncs.error.message}</Callout> : list ? <SyncTable syncs={list} /> : <SyncTableSkeleton />}
    </div>
  );
}
