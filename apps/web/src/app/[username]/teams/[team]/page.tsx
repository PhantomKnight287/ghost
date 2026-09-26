import { BookLock, BookMarked, UsersRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { TeamMembers } from "@/components/organizations/team-members";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  createServerClient,
  getAdminOrganizations,
  getServerSession,
} from "@/lib/api/server";
import { roleLabels } from "@/lib/repository-role";

/** A team's page: who is on it and which repositories it reaches. Teams are for the organization's members, and the API answers anyone else with a 404. */
export default async function TeamPage({
  params,
}: PageProps<"/[username]/teams/[team]">) {
  const { username: organization, team } = await params;
  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);
  const viewer = session?.user.username;
  if (!viewer) notFound();

  const [{ data }, administered] = await Promise.all([
    client.GET("/api/organizations/{slug}/teams/{team}", {
      params: { path: { slug: organization, team } },
    }),
    getAdminOrganizations(),
  ]);
  if (!data) notFound();

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={[viewer]} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-8 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <UsersRound className="size-5" />
          </span>
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold">{data.name}</h1>
            <p className="text-sm text-muted-foreground">
              <Link href={`/${organization}`} className="hover:underline">
                {organization}
              </Link>{" "}
              · mention as @{organization}/{data.slug}
            </p>
          </div>
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold">
            Members
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {data.members.length}
            </span>
          </h2>
          <Card className="gap-0 py-0">
            <TeamMembers
              organization={organization}
              team={team}
              isAdmin={administered.includes(organization)}
            />
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold">
            Repositories
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {data.repositories.length}
            </span>
          </h2>
          {data.repositories.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              This team has no repositories yet. Admins grant access from a
              repository&apos;s Access settings.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.repositories.map((repository) => {
                const Icon =
                  repository.visibility === "private" ? BookLock : BookMarked;
                return (
                  <li
                    key={repository.slug}
                    className="flex items-center gap-3 px-4 py-3 text-sm"
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <Link
                      href={`/${organization}/${repository.slug}`}
                      className="flex-1 font-medium hover:underline"
                    >
                      {repository.name}
                    </Link>
                    <Badge variant="outline">
                      {roleLabels[repository.role]}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
