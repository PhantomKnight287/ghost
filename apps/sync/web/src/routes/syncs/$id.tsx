import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BackToSyncs } from "@/components/layout/back-to-syncs.tsx";
import { SignedIn } from "@/components/layout/signed-in.tsx";
import { ActivityList } from "@/components/syncs/activity-list.tsx";
import { DeleteSync } from "@/components/syncs/delete-sync.tsx";
import { FlaggedRefs } from "@/components/syncs/flagged-refs.tsx";
import { RepositoryPair } from "@/components/syncs/repository-pair.tsx";
import { SyncControls } from "@/components/syncs/sync-controls.tsx";
import { SyncHealth } from "@/components/syncs/sync-health.tsx";
import { SyncStats, SyncStatsSkeleton } from "@/components/syncs/sync-stats.tsx";
import { Callout } from "@/components/ui/callout.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, type SyncDetail } from "@/lib/api.ts";

export const Route = createFileRoute("/syncs/$id")({ ssr: false, component: SyncPage });

/** A backfill or a fresh webhook changes the page while it is open. */
const REFRESH_MS = 10_000;

function SyncPage() {
  const { id } = Route.useParams();
  return (
    <SignedIn>
      <div className="flex flex-col gap-6">
        <BackToSyncs />
        <SyncView id={id} />
      </div>
    </SignedIn>
  );
}

function SyncView({ id }: { id: string }) {
  const detail = useQuery({ queryKey: ["sync", id], queryFn: () => api<SyncDetail>(`/api/syncs/${id}`), refetchInterval: REFRESH_MS });

  if (detail.error) return <Callout tone="danger" title="This sync could not be loaded">{detail.error.message}</Callout>;
  if (!detail.data) return <SyncViewSkeleton />;

  const { sync, flagged, counts, activity, installUrl, webUrl } = detail.data;
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <RepositoryPair ghost={sync.ghostFullName} github={sync.githubFullName} webUrl={webUrl} size="lg" />
          <SyncControls sync={sync} />
        </div>
        <SyncHealth sync={sync} installUrl={installUrl} />
        <FlaggedRefs refs={flagged} />
      </header>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <ActivityList activity={activity} />
        <aside className="lg:pt-12">
          <SyncStats counts={counts} />
        </aside>
      </div>
      <DeleteSync sync={sync} />
    </div>
  );
}

function SyncViewSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <div className="flex items-end justify-between gap-4">
          <div className="flex gap-6">
            <Skeleton className="h-12 w-52" />
            <Skeleton className="h-12 w-52" />
          </div>
          <Skeleton className="h-8 w-44" />
        </div>
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <Skeleton className="h-72 w-full" />
        <SyncStatsSkeleton />
      </div>
    </div>
  );
}
