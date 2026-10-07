import Link from "next/link";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** The fields of a repository every listing of them returns. */
export type Repository = {
  name: string;
  slug: string;
  owner: string;
  description?: string | null;
  visibility: "public" | "private";
  lastPushedAt: string;
};

export function RepositoryCard({
  repository,
  showOwner = false,
  className,
}: {
  repository: Repository;
  showOwner?: boolean;
  className?: string;
}) {
  const { name, slug, owner, description, visibility, lastPushedAt } =
    repository;

  return (
    <article
      className={cn(
        "flex flex-col gap-2 border-b py-4 last:border-b-0",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-base break-words">
          <Link
            href={`/${owner}/${slug}`}
            className="text-primary hover:underline"
          >
            {showOwner && <span className="font-normal">{owner}/</span>}
            <span className="font-semibold">{name}</span>
          </Link>
        </h3>

        <Badge variant="outline" className="shrink-0 rounded-full capitalize">
          {visibility}
        </Badge>
      </div>

      {description && (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>
          Updated <FromNowHoverCard date={lastPushedAt} />
        </span>
      </div>
    </article>
  );
}
