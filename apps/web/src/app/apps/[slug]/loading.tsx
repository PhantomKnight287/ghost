import { Skeleton } from "@/components/ui/skeleton";

export default function PublicAppLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 md:px-6">
      <div className="flex items-center gap-6">
        <Skeleton className="size-20 rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-20" />
      </div>
      <Skeleton className="h-4 w-full max-w-lg" />
      <Skeleton className="h-4 w-40" />
    </main>
  );
}
