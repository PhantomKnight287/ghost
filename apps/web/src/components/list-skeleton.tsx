import { Skeleton } from "@/components/ui/skeleton";

/** A page title over a bordered list, the shape of every list page while it loads. `avatar` rows lead with a picture, `detail` rows carry a second line. */
export function ListSkeleton({
  rows = 6,
  title = true,
  avatar = false,
  detail = false,
}: {
  rows?: number;
  title?: boolean;
  avatar?: boolean;
  detail?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {title && <Skeleton className="h-7 w-40" />}
      <ul className="divide-y rounded-lg border">
        {Array.from({ length: rows }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className={avatar ? "size-9 rounded-full" : "size-4"} />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton
                className="h-4"
                style={{ width: `${120 + ((index * 53) % 160)}px` }}
              />
              {detail && <Skeleton className="h-3 w-48" />}
            </div>
            <Skeleton className="h-3 w-16" />
          </li>
        ))}
      </ul>
    </div>
  );
}
