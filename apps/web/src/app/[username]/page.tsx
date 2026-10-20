import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";

import { AppHeader } from "@/components/app-header";
import { pageLinks } from "@/lib/agent-pages";
import { createServerClient, getServerSession } from "@/lib/api/server";
import { plural } from "@/lib/og";

import { Profile, ProfileSkeleton } from "./profile";

/** The user and the organization a name could be, fetched once for the metadata and the page. */
const loadOwner = cache(async (username: string) => {
  const client = await createServerClient();
  return Promise.all([
    client.GET("/api/users/{username}", { params: { path: { username } } }),
    client.GET("/api/organizations/{slug}", {
      params: { path: { slug: username } },
    }),
  ]);
});

export async function generateMetadata({
  params,
}: PageProps<"/[username]">): Promise<Metadata> {
  const { username } = await params;

  const [{ data, response }, organization] = await loadOwner(username);
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
      ...pageLinks(`/${username}`),
    };
  }
  if (response.status === 404) notFound();
  if (!data) return { title: username };

  const title = `${data.name} (@${data.username})`;
  const description = `${data.repositoryCount} public repositories · ${data.starCount} stars`;

  return {
    title,
    description,
    openGraph: { title, description, url: `/${data.username}` },
    ...pageLinks(`/${data.username}`),
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: PageProps<"/[username]">) {
  const { username } = await params;
  const { tab, q, cursor } = await searchParams;
  const viewer = (await getServerSession())?.user.username ?? "";
  // Before the Suspense boundary, so an unknown name answers a real 404 rather than a 200 with the not-found page streamed into it.
  const [user, organization] = await loadOwner(username);
  if (!organization.data && user.response.status === 404) notFound();

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} />

      <Suspense fallback={<ProfileSkeleton />}>
        <Profile
          username={username}
          viewer={viewer}
          tab={tab}
          query={typeof q === "string" ? q.trim() : ""}
          cursor={typeof cursor === "string" ? cursor : undefined}
        />
      </Suspense>
    </div>
  );
}
