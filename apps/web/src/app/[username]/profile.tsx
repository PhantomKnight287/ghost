import { Globe, Mail, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CursorPagination } from "@/components/cursor-pagination";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { MembershipActions } from "./membership-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RepositoryReadme,
  RepositoryReadmeSkeleton,
} from "@/components/repositories/repository-readme";
import { ContributionGraphSkeleton } from "./contribution-graph";
import {
  OrganizationTeamList,
  OrganizationTeamListSkeleton,
} from "./organization-team-list";
import { PeopleList, PeopleListSkeleton, PersonCard } from "./people-list";
import { PinnedRepositories } from "./pinned-repositories";
import { ProfileContributions } from "./profile-contributions";
import { UserOrganizations } from "./user-organizations";
import { createServerClient, getAdminOrganizations } from "@/lib/api/server";
import { plural } from "@/lib/og";
import { cn } from "@/lib/utils";

import { ProfileTabs } from "./page.client";
import Link from "next/link";

export async function Profile({
  username,
  viewer,
  tab,
  query,
  cursor,
}: {
  username: string;
  viewer: string;
  tab?: string | string[];
  query: string;
  cursor?: string;
}) {
  const client = await createServerClient();
  const [profile, organization, { data, error, response }] = await Promise.all([
    client.GET("/api/users/{username}", { params: { path: { username } } }),
    client.GET("/api/organizations/{slug}", {
      params: { path: { slug: username } },
    }),
    client.GET("/api/repositories/{username}", {
      params: {
        path: { username },
        query: {
          limit: 20,
          q: query || undefined,
          cursor,
        },
      },
    }),
  ]);

  if (response.status === 404) {
    notFound();
  }

  if (error || !data) {
    throw new Error(`Failed to load repositories for ${username}`);
  }

  const org = organization.data;
  // May create repositories here: the user themselves, or an admin of the organization.
  const isViewer = org
    ? (await getAdminOrganizations()).includes(username)
    : viewer === username;

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-8 md:px-6 md:grid-cols-[280px_1fr]">
      <aside className="flex flex-col gap-4">
        <ProfileAvatar
          name={username}
          image={org ? org.logo : profile.data?.image}
          className={cn(
            "size-40 md:size-64",
            org ? "rounded-2xl" : "rounded-full",
          )}
          fallbackClassName="text-4xl"
        />

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {org?.name ?? profile.data?.name ?? username}
          </h1>
          <p className="flex items-center gap-2 text-lg text-muted-foreground">
            {username}
            {org && <Badge variant="outline">Organization</Badge>}
          </p>
          {org?.description && (
            <p className="pt-1 text-sm text-balance">{org.description}</p>
          )}
        </div>

        {org && (org.location || org.website || org.email) && (
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {org.location && (
              <li className="flex items-center gap-2">
                <MapPin className="size-4 shrink-0" />
                {org.location}
              </li>
            )}
            {org.website && (
              <li className="flex min-w-0 items-center gap-2">
                <Globe className="size-4 shrink-0" />
                <a
                  href={org.website}
                  rel="nofollow noopener noreferrer"
                  target="_blank"
                  className="truncate hover:underline"
                >
                  {org.website.replace(/^https?:\/\//, "")}
                </a>
              </li>
            )}
            {org.email && (
              <li className="flex min-w-0 items-center gap-2">
                <Mail className="size-4 shrink-0" />
                <a
                  href={`mailto:${org.email}`}
                  className="truncate hover:underline"
                >
                  {org.email}
                </a>
              </li>
            )}
          </ul>
        )}

        {org?.viewerRole && viewer && (
          <MembershipActions
            slug={username}
            isPublic={
              org.members.find((member) => member.username === viewer)
                ?.public ?? false
            }
          />
        )}
        {org && isViewer && (
          <Link
            href={`/${username}/settings`}
            className={buttonVariants({
              className: "w-full",
              variant: "outline",
            })}
          >
            Settings
          </Link>
        )}
        {!org && isViewer && (
          <Link
            href="/settings"
            className={buttonVariants({
              className: "w-full",
              variant: "outline",
            })}
          >
            Edit profile
          </Link>
        )}
        <Separator />

        <p className="text-sm text-muted-foreground">
          {org
            ? [
                // Membership is private: only members are told how many there are.
                org.viewerRole && plural(org.members.length, "member"),
                plural(
                  org.repositoryCount,
                  "public repository",
                  "public repositories",
                ),
              ]
                .filter(Boolean)
                .join(" · ")
            : profile.data
              ? `${profile.data.repositoryCount} repositories · ${profile.data.starCount} stars`
              : "No bio yet."}
        </p>
      </aside>

      <section className="flex flex-col gap-6">
        <ProfileTabs
          username={username}
          isViewer={isViewer}
          owners={viewer ? [viewer] : []}
          extraTabs={
            org
              ? [
                  {
                    value: "people",
                    label: "People",
                    content: (
                      <PeopleList
                        empty={
                          org.viewerRole
                            ? `${username} has no members yet.`
                            : `Nobody in ${username} has made their membership public.`
                        }
                      >
                        {org.members.map((member) => (
                          <PersonCard
                            key={member.username}
                            handle={member.username}
                            name={member.name}
                            image={member.image}
                          />
                        ))}
                      </PeopleList>
                    ),
                  },
                  // Teams are for members only.
                  ...(org.viewerRole
                    ? [
                        {
                          value: "teams",
                          label: "Teams",
                          content: (
                            <Suspense
                              fallback={<OrganizationTeamListSkeleton />}
                            >
                              <OrganizationTeamList slug={username} />
                            </Suspense>
                          ),
                        },
                      ]
                    : []),
                ]
              : [
                  {
                    value: "organizations",
                    label: "Organizations",
                    content: (
                      <Suspense fallback={<PeopleListSkeleton />}>
                        <UserOrganizations
                          username={username}
                          isViewer={isViewer}
                        />
                      </Suspense>
                    ),
                  },
                ]
          }
          defaultTab={tab === "repositories" ? "repositories" : "overview"}
          repositories={data.repositories}
          query={query}
          pagination={
            <CursorPagination
              pathname={`/${username}`}
              params={{ tab: "repositories", q: query }}
              cursor={cursor}
              nextCursor={data.nextCursor}
            />
          }
          overview={
            <>
              <Suspense fallback={<RepositoryReadmeSkeleton bare />}>
                {/* The README of user/user is that person's bio; an organization's lives at .ghost/profile/README.md. */}
                <RepositoryReadme
                  owner={username}
                  slug={org ? ".ghost" : username}
                  path={org ? "profile" : undefined}
                  bare
                  fallback={
                    <p className="text-sm text-muted-foreground">
                      {username} hasn&apos;t written a profile README yet.
                    </p>
                  }
                />
              </Suspense>
              {org && org.pinned.length > 0 && (
                <PinnedRepositories owner={username} pinned={org.pinned} />
              )}
              {!org && (
                <Suspense fallback={<ContributionGraphSkeleton />}>
                  <ProfileContributions username={username} />
                </Suspense>
              )}
            </>
          }
        />
      </section>
    </main>
  );
}

export function ProfileSkeleton() {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-8 md:px-6 md:grid-cols-[280px_1fr]">
      <aside className="flex flex-col gap-4">
        <Skeleton className="size-40 rounded-full md:size-64" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-5 w-28" />
        </div>
        <Skeleton className="h-9 w-full" />
      </aside>
      <section className="flex flex-col gap-6">
        <Skeleton className="h-9 w-64" />
        <RepositoryReadmeSkeleton bare />
      </section>
    </main>
  );
}
