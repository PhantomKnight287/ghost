import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Keyset cursors only run forward, so the way back is the first page. Renders nothing when everything fits on one page. */
export function CursorPagination({
  firstHref,
  nextHref,
  isFirstPage,
}: {
  firstHref: string;
  nextHref: string | null;
  isFirstPage: boolean;
}) {
  if (isFirstPage && !nextHref) return null;

  const link = (enabled: boolean) =>
    buttonVariants({
      variant: "outline",
      size: "sm",
      className: cn(!enabled && "pointer-events-none opacity-50"),
    });

  return (
    <div className="flex justify-center gap-2">
      <Link
        href={firstHref}
        aria-disabled={isFirstPage}
        className={link(!isFirstPage)}
      >
        Newest
      </Link>
      <Link
        href={nextHref ?? firstHref}
        aria-disabled={!nextHref}
        className={link(nextHref !== null)}
      >
        Older
      </Link>
    </div>
  );
}
