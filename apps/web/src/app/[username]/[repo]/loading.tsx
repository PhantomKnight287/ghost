/** biome-ignore-all lint/suspicious/noArrayIndexKey: skeleton rows have no id */
import { Skeleton } from "@/components/ui/skeleton";

export default function RepositoryLoadingPage() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Skeleton className="h-8 w-[180px]" />

      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-full" />
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="ml-auto h-3 w-14" />
          <Skeleton className="h-3 w-20" />
        </div>

        <ul className="divide-y">
          {Array.from({ length: 8 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3 px-4 py-2.5">
              <Skeleton className="size-4" />
              <Skeleton
                className="h-4"
                style={{ width: `${90 + ((index * 37) % 110)}px` }}
              />
              <Skeleton className="ml-auto hidden h-3 w-48 md:block" />
              <Skeleton className="h-3 w-20" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
