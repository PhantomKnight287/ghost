/** biome-ignore-all lint/suspicious/noArrayIndexKey: skeleton rows have no id */
import { Skeleton } from "@/components/ui/skeleton";

export default function TagsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y rounded-lg border">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-3 w-14" />
          </li>
        ))}
      </ul>
    </div>
  );
}
