import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { createServerClient } from "@/lib/api/server";

const SHOWN = 14;

/** The repository root's sidebar list of who committed, as GitHub shows it: the busiest first, the rest behind the full page. */
export async function RepositoryContributors({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/contributors",
    { params: { path: { username, slug: repo }, query: { limit: SHOWN } } },
  );
  if (!data || data.contributors.length === 0) return null;

  const href = `/${username}/${repo}/contributors`;
  const more = data.totalContributors - data.contributors.length;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        <Link href={href} className="hover:underline">
          Contributors
        </Link>{" "}
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal tabular-nums">
          {data.totalContributors}
        </span>
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {data.contributors.map((contributor) => {
          const avatar = (
            <ProfileAvatar
              name={contributor.name}
              image={contributor.image}
              className="size-8"
            />
          );
          return (
            <li
              key={contributor.username ?? contributor.name}
              title={`${contributor.name} · ${contributor.commits} commits`}
            >
              {contributor.username ? (
                <Link href={`/${contributor.username}`}>{avatar}</Link>
              ) : (
                avatar
              )}
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <Link
          href={href}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          + {more} more
        </Link>
      )}
    </div>
  );
}

export function RepositoryContributorsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-28" />
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="size-8 rounded-full" />
        ))}
      </div>
    </div>
  );
}
