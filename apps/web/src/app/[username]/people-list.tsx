import Link from "next/link";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { cn } from "@/lib/utils";

/** Accounts linked from a profile: an organization's members, or the organizations a user is in. */
export function PeopleList({
  empty,
  children,
}: {
  empty: string;
  children: ReactNode[];
}) {
  if (children.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return <ul className="grid gap-2 sm:grid-cols-2">{children}</ul>;
}

export function PersonCard({
  handle,
  name,
  image,
  square = false,
}: {
  handle: string;
  name: string;
  image: string | null;
  square?: boolean;
}) {
  return (
    <li>
      <Link
        href={`/${handle}`}
        className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50"
      >
        <ProfileAvatar
          name={handle}
          image={image}
          className={cn("size-10", square && "rounded-lg")}
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {handle}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function PeopleListSkeleton() {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <li key={index}>
          <Skeleton className="h-[66px] rounded-lg" />
        </li>
      ))}
    </ul>
  );
}
