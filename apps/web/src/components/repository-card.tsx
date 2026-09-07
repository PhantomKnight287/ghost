import Link from "next/link";
import { GitFork, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type RepositoryVisibility = "public" | "private";

export type Repository = {
  name: string;
  slug: string;
  owner: string;
  description?: string;
  visibility: RepositoryVisibility;
  language?: string;
  languageColor?: string;
  stars?: number;
  forks?: number;
  updatedAt: string;
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
  const {
    name,
    slug,
    owner,
    description,
    visibility,
    language,
    languageColor,
    stars,
    forks,
    updatedAt,
  } = repository;

  return (
    <article
      className={cn(
        "flex flex-col gap-2 border-b py-4 last:border-b-0",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold">
          <Link
            href={`/${owner}/${slug}`}
            className="text-primary hover:underline"
          >
            {showOwner ? `${owner}/${name}` : name}
          </Link>
        </h3>

        <Badge variant="outline" className="rounded-full capitalize">
          {visibility}
        </Badge>
      </div>

      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {language && (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{
                backgroundColor: languageColor ?? "var(--muted-foreground)",
              }}
            />
            {language}
          </span>
        )}

        {stars !== undefined && (
          <span className="flex items-center gap-1">
            <Star className="size-3.5" />
            {stars}
          </span>
        )}

        {forks !== undefined && (
          <span className="flex items-center gap-1">
            <GitFork className="size-3.5" />
            {forks}
          </span>
        )}

        <span>Updated {updatedAt}</span>
      </div>
    </article>
  );
}
