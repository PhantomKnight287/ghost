import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AppHeader } from "@/components/app-header";
import { createServerClient, getServerSession } from "@/lib/api/server";
import { plural } from "@/lib/og";

import { Profile, ProfileSkeleton } from "./profile";

export async function generateMetadata({
  params,
}: PageProps<"/[username]">): Promise<Metadata> {
  const { username } = await params;

  const client = await createServerClient();
  const [{ data, response }, organization] = await Promise.all([
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
  if (response.status === 404) notFound();
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
  const viewer = (await getServerSession())?.user.username ?? "";

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
