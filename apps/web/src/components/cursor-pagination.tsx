"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  pathname: string;
  /** The page's other query parameters, kept on both links; unset ones are dropped. */
  params?: Record<string, string | undefined>;
  cursor: string | undefined;
  nextCursor: string | null | undefined;
};

/** Keyset cursors only run forward, so the cursors of the pages already passed ride along in the URL as repeated `prev` parameters, and Newer steps back to the last of them. Renders nothing when everything fits on one page. */
export function CursorPagination(props: Props) {
  // Prerendering cannot read the URL, so it shows the links without the trail until the client has it.
  return (
    <Suspense fallback={<CursorPaginationLinks {...props} trail={[]} />}>
      <TrailedLinks {...props} />
    </Suspense>
  );
}

function TrailedLinks(props: Props) {
  const trail = useSearchParams()?.getAll("prev") ?? [];
  return <CursorPaginationLinks {...props} trail={trail} />;
}

// ponytail: the URL grows by one cursor per page; cap the trail if anyone pages hundreds deep.
export function CursorPaginationLinks({
  pathname,
  params = {},
  cursor,
  nextCursor,
  trail,
}: Props & {
  /** Cursors of the pages between the first and this one, oldest first. */
  trail: string[];
}) {
  const isFirstPage = !cursor;
  if (isFirstPage && !nextCursor) return null;

  const kept = Object.entries(params).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );
  const href = (prev: string[], at: string | undefined) => {
    const search = new URLSearchParams([
      ...kept,
      ...prev.map((value): [string, string] => ["prev", value]),
      ...(at ? [["cursor", at] as [string, string]] : []),
    ]).toString();
    return search ? `${pathname}?${search}` : pathname;
  };
  const newerHref = href(trail.slice(0, -1), trail.at(-1));
  const olderHref = nextCursor
    ? href(cursor ? [...trail, cursor] : trail, nextCursor)
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
        href={newerHref}
        aria-disabled={isFirstPage}
        className={link(!isFirstPage)}
      >
        Newer
      </Link>
      <Link
        href={olderHref ?? newerHref}
        aria-disabled={!olderHref}
        className={link(olderHref !== null)}
      >
        Older
      </Link>
    </div>
  );
}
