import { GitFork, Star, Users } from "lucide-react";
import Link from "next/link";

/** Description and the counts that have a page of their own behind them. */
export function RepositoryAbout({
  username,
  slug,
  description,
  starCount,
  forkCount,
}: {
  username: string;
  slug: string;
  description?: string | null;
  starCount: number;
  forkCount: number;
}) {
  const base = `/${username}/${slug}`;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">About</h2>

      <p className="text-sm text-muted-foreground">
        {description || "No description provided."}
      </p>

      <div className="flex flex-col gap-2 text-sm">
        <Link
          href={`${base}/stargazers`}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <Star className="size-4" />
          <span className="font-medium text-foreground tabular-nums">
            {starCount}
          </span>
          {starCount === 1 ? "star" : "stars"}
        </Link>

        <Link
          href={`${base}/forks`}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <GitFork className="size-4" />
          <span className="font-medium text-foreground tabular-nums">
            {forkCount}
          </span>
          {forkCount === 1 ? "fork" : "forks"}
        </Link>

        <Link
          href={`${base}/contributors`}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <Users className="size-4" />
          Contributors
        </Link>
      </div>
    </div>
  );
}
