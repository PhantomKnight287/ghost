import { ReleaseCardSkeleton } from "@/components/releases/release-card";

export default function ReleasesLoading() {
  return (
    <div className="flex flex-col gap-4">
      <ReleaseCardSkeleton />
      <ReleaseCardSkeleton />
    </div>
  );
}
