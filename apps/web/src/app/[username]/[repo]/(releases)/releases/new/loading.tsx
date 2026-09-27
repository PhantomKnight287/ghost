import { ReleaseFormSkeleton } from "@/components/releases/release-form";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewReleaseLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-64" />
      </div>
      <ReleaseFormSkeleton />
    </div>
  );
}
