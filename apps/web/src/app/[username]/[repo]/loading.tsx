/** biome-ignore-all lint/suspicious/noArrayIndexKey: <explanation> */
import { BookMarked, } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

export default function RepositoryLoadingPage() {
  return (
    <div className="flex min-h-full flex-col">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <BookMarked className="size-5 text-muted-foreground" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-6 w-16 rounded-full" />

          <div className="ml-auto flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>

        <Skeleton className="h-4 w-2/3 max-w-md" />

        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-[180px]" />
          <Skeleton className="h-9 w-56" />
        </div>

        <div className="flex flex-col gap-2 pt-6">
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
      </main>
    </div>
  );
}
