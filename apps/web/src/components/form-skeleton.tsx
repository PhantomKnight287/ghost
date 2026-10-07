/** biome-ignore-all lint/suspicious/noArrayIndexKey: skeleton fields have no id */
import { Skeleton } from "@/components/ui/skeleton";

/** A heading over a card of labelled fields, the shape of a form page while it loads. */
export function FormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-6 rounded-lg border p-6">
        {Array.from({ length: fields }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <Skeleton className="h-9 w-32 self-end" />
      </div>
    </div>
  );
}
