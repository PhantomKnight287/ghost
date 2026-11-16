import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SignedIn } from "@/components/layout/signed-in.tsx";
import { SyncTable, SyncTableSkeleton } from "@/components/syncs/sync-table.tsx";
import { buttonClass } from "@/components/ui/button.tsx";
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
  const syncs = useQuery({ queryKey: ["syncs"], queryFn: () => api<{ syncs: Sync[] }>("/api/syncs") });
  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your syncs</h1>
        <Link to="/new" className={buttonClass()}>
          + New sync
        </Link>
      </div>
      {syncs.error ? <p className="text-red-600">{syncs.error.message}</p> : syncs.data ? <SyncTable syncs={syncs.data.syncs} /> : <SyncTableSkeleton />}
    </section>
  );
}
