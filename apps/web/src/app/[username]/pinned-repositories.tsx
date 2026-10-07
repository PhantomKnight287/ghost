import Link from "next/link";

import { Badge } from "@/components/ui/badge";

/** Up to six repositories the organization chose to show first. */
export function PinnedRepositories({
  owner,
  pinned,
}: {
  owner: string;
  pinned: {
    slug: string;
    name: string;
    description: string | null;
    visibility: "public" | "private";
  }[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Pinned</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {pinned.map((repository) => (
          <li
            key={repository.slug}
            className="flex flex-col gap-1 rounded-lg border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/${owner}/${repository.slug}`}
                className="truncate text-sm font-semibold text-primary hover:underline"
              >
                {repository.name}
              </Link>
              <Badge variant="outline" className="shrink-0 capitalize">
                {repository.visibility}
              </Badge>
            </div>
            {repository.description && (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {repository.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
