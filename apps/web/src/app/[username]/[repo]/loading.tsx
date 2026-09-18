/** biome-ignore-all lint/suspicious/noArrayIndexKey: skeleton rows have no id */
import { Skeleton } from "@/components/ui/skeleton";

/** Only the listing: the frame keeps the branch row and the sidebar mounted. */
export default function RepositoryLoadingPage() {
  return (
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
  );
}
