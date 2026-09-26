import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Keyset cursors only run forward, so the way back is the first page. Renders nothing when everything fits on one page. */
export function CursorPagination({
  pathname,
  params = {},
  cursor,
  nextCursor,
}: {
  pathname: string;
  /** The page's other query parameters, kept on both links; unset ones are dropped. */
  params?: Record<string, string | undefined>;
  cursor: string | undefined;
  nextCursor: string | null | undefined;
}) {
  const isFirstPage = !cursor;
  if (isFirstPage && !nextCursor) return null;

  const kept = Object.entries(params).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );
  const firstHref = kept.length
    ? `${pathname}?${new URLSearchParams(kept)}`
    : pathname;
  const nextHref = nextCursor
    ? `${pathname}?${new URLSearchParams([...kept, ["cursor", nextCursor]])}`
    : null;

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
