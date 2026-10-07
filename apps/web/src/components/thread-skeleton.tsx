/** biome-ignore-all lint/suspicious/noArrayIndexKey: skeleton comments have no id */
import { Skeleton } from "@/components/ui/skeleton";

/** Comments down the main column and a sidebar, the shape of an issue or pull request conversation while it loads. */
export function ThreadSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_220px]">
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2 rounded-lg border p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
