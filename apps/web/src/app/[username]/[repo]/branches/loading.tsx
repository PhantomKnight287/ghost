import { Skeleton } from "@/components/ui/skeleton";

export default function BranchesLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-24" />
      <ul className="divide-y rounded-lg border">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-36" />
          </li>
        ))}
      </ul>
    </div>
  );
}
