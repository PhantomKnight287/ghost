"use client";

import Link from "next/link";
import { BookLock, BookMarked } from "lucide-react";
import type { Repository } from "@/components/repository-card";
import { FromNowHoverCard } from "@/components/from-now-card";

/** One line per repository: the sidebar is too narrow for a card. */
export function RepositoryRow({ repository }: { repository: Repository }) {
  const fullName = `${repository.owner}/${repository.name}`;
  const Icon = repository.visibility === "private" ? BookLock : BookMarked;

  return (
    <Link
      href={`/${repository.owner}/${repository.slug}`}
      title={fullName}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
    >
      <Icon
        className="size-4 shrink-0 text-muted-foreground"
        aria-label={repository.visibility}
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{repository.owner}/</span>
        <span className="font-medium">{repository.name}</span>
      </span>
      <FromNowHoverCard
        date={repository.updatedAt}
        className="shrink-0 text-xs text-muted-foreground"
      />
    </Link>
  );
}
