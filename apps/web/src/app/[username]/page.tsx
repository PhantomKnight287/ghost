import { Globe, Mail, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AppHeader } from "@/components/app-header";
import { CursorPagination } from "@/components/cursor-pagination";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { MembershipActions } from "./membership-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import {
  createServerClient,
  getAdminOrganizations,
  getServerSession,
} from "@/lib/api/server";
import { plural } from "@/lib/og";
import { cn } from "@/lib/utils";

import { ProfileTabs } from "./page.client";
import { REPOSITORIES_PAGE_SIZE } from "./constants";
import Link from "next/link";

export async function generateMetadata({
  params,
}: PageProps<"/[username]">): Promise<Metadata> {
  const { username } = await params;

  const client = await createServerClient();
  const [{ data }, organization] = await Promise.all([
    client.GET("/api/users/{username}", { params: { path: { username } } }),
    client.GET("/api/organizations/{slug}", {
      params: { path: { slug: username } },
    }),
  ]);
  if (organization.data) {
    const title = organization.data.name;
    const description = plural(
      organization.data.repositoryCount,
      "public repository",
      "public repositories",
    );
    return {
      title,
      description,
      openGraph: { title, description, url: `/${username}` },
    };
  }
  if (!data) return { title: username };

  const title = `${data.name} (@${data.username})`;
  const description = `${data.repositoryCount} public repositories · ${data.starCount} stars`;

  return {
    title,
    description,
    openGraph: { title, description, url: `/${data.username}` },
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: PageProps<"/[username]">) {
  const { username } = await params;
  const { tab, q, cursor } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const pageCursor = typeof cursor === "string" ? cursor : undefined;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);
  const viewer = session?.user.username ?? "";

  const [profile, organization, { data, error, response }] = await Promise.all([
    client.GET("/api/users/{username}", { params: { path: { username } } }),
    client.GET("/api/organizations/{slug}", {
      params: { path: { slug: username } },
    }),
    client.GET("/api/repositories/{username}", {
      params: {
        path: { username },
        query: {
          limit: REPOSITORIES_PAGE_SIZE,
          q: query || undefined,
          cursor: pageCursor,
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
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} />

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
                cursor={pageCursor}
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
    </div>
  );
}
