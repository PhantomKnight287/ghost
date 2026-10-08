import { Skeleton } from "@/components/ui/skeleton";

/** Bordered files of code lines, the shape of a file view or a diff while it loads. */
export function CodeSkeleton({ files = 1 }: { files?: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: files }).map((_, file) => (
        <div key={file} className="overflow-hidden rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 12 }).map((_, line) => (
              <Skeleton
                key={line}
                className="h-3.5"
                style={{ width: `${30 + ((line * 41 + file * 17) % 60)}%` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
