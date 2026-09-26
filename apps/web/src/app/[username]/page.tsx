import { Globe, Mail, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AppHeader } from "@/components/app-header";
import { CursorPagination } from "@/components/cursor-pagination";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MembershipActions } from "@/components/organizations/membership-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  RepositoryReadme,
  RepositoryReadmeSkeleton,
} from "@/components/repositories/repository-readme";
import {
  ContributionGraph,
  ContributionGraphSkeleton,
} from "@/components/profile/contribution-graph";
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
      <AppHeader username={viewer} owners={viewer ? [viewer] : []} />

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-8 md:px-6 md:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-4">
          <Avatar
            className={cn(
              "size-40 md:size-64",
              org ? "rounded-2xl" : "rounded-full",
            )}
          >
            <AvatarImage
              alt={username}
              src={(org ? org.logo : profile.data?.image) ?? undefined}
            />
            <AvatarFallback className="text-4xl">
              {username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

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
          {!org && (
            <Link
              href={`/settings`}
              className={buttonVariants({
                className: "w-full",
                variant: "outline",
              })}
            >
              {isViewer ? "Edit profile" : "Follow"}
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
                          people={org.members.map((member) => ({
                            href: `/${member.username}`,
                            title: member.name,
                            subtitle: member.username,
                            image: member.image,
                          }))}
                          empty={
                            org.viewerRole
                              ? `${username} has no members yet.`
                              : `Nobody in ${username} has made their membership public.`
                          }
                        />
                      ),
                    },
                    // Teams are for members only.
                    ...(org.viewerRole
                      ? [
                          {
                            value: "teams",
                            label: "Teams",
                            content: (
                              <Suspense fallback={null}>
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
                        <Suspense fallback={null}>
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
                {org && org.pinned.length > 0 && (
                  <PinnedRepositories owner={username} pinned={org.pinned} />
                )}
                <Suspense fallback={<RepositoryReadmeSkeleton bare />}>
                  {org ? (
                    // ORG's readme at .ghost/profile/README.md
                    <ProfileReadme
                      username={username}
                      slug=".ghost"
                      path="profile"
                    />
                  ) : (
                    <ProfileReadme username={username} slug={username} />
                  )}
                </Suspense>
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

/** The repository named after its owner is that person's bio, the way GitHub treats it. There is no separate bio to store: the README of `user/user` is it, and the API already refuses to serve one the viewer may not read. */
async function ProfileReadme({
  username,
  slug,
  path,
}: {
  username: string;
  slug: string;
  path?: string;
}) {
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/readme",
    { params: { path: { username, slug }, query: { path } } },
  );

  if (!data?.content) {
    return (
      <p className="text-sm text-muted-foreground">
        {username} hasn&apos;t written a profile README yet.
      </p>
    );
  }

  return <RepositoryReadme readme={data} owner={username} slug={slug} bare />;
}

async function ProfileContributions({ username }: { username: string }) {
  const client = await createServerClient();
  const { data } = await client.GET("/api/users/{username}/contributions", {
    params: { path: { username } },
  });

  if (!data) return null;

  return <ContributionGraph data={data} />;
}

/** Membership is private, so another user's list holds only the organizations the viewer shares with them. */
async function UserOrganizations({
  username,
  isViewer,
}: {
  username: string;
  isViewer: boolean;
}) {
  const client = await createServerClient();
  const { data } = await client.GET("/api/users/{username}/organizations", {
    params: { path: { username } },
  });

  return (
    <PeopleList
      people={(data?.organizations ?? []).map((org) => ({
        href: `/${org.slug}`,
        title: org.name,
        subtitle: org.slug,
        image: org.logo,
      }))}
      empty={
        isViewer
          ? "You aren't a member of any organizations."
          : `You share no organizations with ${username}.`
      }
      square
    />
  );
}

/** Accounts linked from a profile: an organization's members, or the organizations a user is in. */
function PeopleList({
  people,
  empty,
  square = false,
}: {
  people: {
    href: string;
    title: string;
    subtitle: string;
    image: string | null;
  }[];
  empty: string;
  square?: boolean;
}) {
  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {people.map((person) => (
        <li key={person.href}>
          <Link
            href={person.href}
            className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50"
          >
            <Avatar className={cn("size-10", square && "rounded-lg")}>
              <AvatarImage src={person.image ?? undefined} alt="" />
              <AvatarFallback>
                {person.subtitle.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {person.title}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {person.subtitle}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Up to six repositories the organization chose to show first. */
function PinnedRepositories({
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

async function OrganizationTeamList({ slug }: { slug: string }) {
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
