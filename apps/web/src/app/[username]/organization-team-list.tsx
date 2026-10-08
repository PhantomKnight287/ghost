import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { createServerClient } from "@/lib/api/server";
import { plural } from "@/lib/og";

export async function OrganizationTeamList({ slug }: { slug: string }) {
  const client = await createServerClient();
  const { data } = await client.GET("/api/organizations/{slug}/teams", {
    params: { path: { slug } },
  });
  const teams = data?.teams ?? [];

  if (teams.length === 0) {
    return <p className="text-sm text-muted-foreground">No teams yet.</p>;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {teams.map((team) => (
        <li key={team.id}>
          <Link
            href={`/${slug}/teams/${team.slug}`}
            className="flex flex-col rounded-lg border p-3 hover:bg-muted/50"
          >
            <span className="text-sm font-medium">{team.name}</span>
            <span className="text-xs text-muted-foreground">
              {plural(team.memberCount, "member")} ·{" "}
              {plural(team.repositoryCount, "repository", "repositories")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function OrganizationTeamListSkeleton() {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <li key={index}>
          <Skeleton className="h-[58px] rounded-lg" />
        </li>
      ))}
    </ul>
  );
}
