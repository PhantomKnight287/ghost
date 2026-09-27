import { ReleaseCardSkeleton } from "@/components/releases/release-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ReleaseLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-40" />
      <ReleaseCardSkeleton />
    </div>
  );
}
