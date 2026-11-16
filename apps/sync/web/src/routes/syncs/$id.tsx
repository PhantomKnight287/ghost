import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SignedIn } from "@/components/layout/signed-in.tsx";
import { ActivityList } from "@/components/syncs/activity-list.tsx";
import { FlaggedRefs } from "@/components/syncs/flagged-refs.tsx";
import { SyncActions } from "@/components/syncs/sync-actions.tsx";
import { SyncHealth } from "@/components/syncs/sync-health.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, type SyncDetail } from "@/lib/api.ts";

export const Route = createFileRoute("/syncs/$id")({ ssr: false, component: SyncPage });

/** A backfill or a fresh webhook changes the page while it is open. */
const REFRESH_MS = 10_000;

function SyncPage() {
  const { id } = Route.useParams();
  return (
    <SignedIn>
      <SyncView id={id} />
    </SignedIn>
  );
}

function SyncView({ id }: { id: string }) {
  const detail = useQuery({ queryKey: ["sync", id], queryFn: () => api<SyncDetail>(`/api/syncs/${id}`), refetchInterval: REFRESH_MS });

  if (detail.error) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-red-600">{detail.error.message}</p>
        <Link to="/" className="underline underline-offset-4">
          Back to your syncs
        </Link>
      </div>
    );
  }
  if (!detail.data) return <SyncViewSkeleton />;

  const { sync, flagged, activity, installUrl } = detail.data;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link to="/" className="text-sm text-neutral-500 hover:underline">
          ← Your syncs
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          {sync.ghostFullName} <span className="text-neutral-400">⇄</span> {sync.githubFullName}
        </h1>
        <SyncHealth sync={sync} installUrl={installUrl} />
      </div>
      <SyncActions sync={sync} />
      <FlaggedRefs refs={flagged} />
      <ActivityList activity={activity} />
    </div>
  );
}

function SyncViewSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-96 max-w-full" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
