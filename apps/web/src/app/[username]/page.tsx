import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { createServerClient, getServerSession } from "@/lib/api/server";

import { ProfileTabs } from "./page.client";
import { REPOSITORIES_PAGE_SIZE } from "./constants";

export async function generateMetadata({
  params,
}: PageProps<"/[username]">): Promise<Metadata> {
  const { username } = await params;

  const client = await createServerClient();
  const { data } = await client.GET("/api/users/{username}", {
    params: { path: { username } },
  });
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
}: PageProps<"/[username]">) {
  const { username } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);
  const viewer = session?.user.username ?? "";
  const isViewer = viewer === username;

  const [profile, { data, error, response }] = await Promise.all([
    client.GET("/api/users/{username}", { params: { path: { username } } }),
    client.GET("/api/repositories/{username}", {
      params: {
        path: { username },
        query: { limit: REPOSITORIES_PAGE_SIZE },
      },
    }),
  ]);

  if (response.status === 404) {
    notFound();
  }

  if (error || !data) {
    throw new Error(`Failed to load repositories for ${username}`);
  }

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={viewer ? [viewer] : []} />

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-8 md:px-6 md:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-4">
          <Avatar className="size-40 rounded-full md:size-64">
            <AvatarImage
              alt={username}
              src={profile.data?.image ?? undefined}
            />
            <AvatarFallback className="text-4xl">
              {username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex flex-col">
            <h1 className="text-2xl font-semibold tracking-tight">
              {profile.data?.name ?? username}
            </h1>
            <p className="text-lg text-muted-foreground">{username}</p>
          </div>

          <Button variant="outline" className="w-full">
            {isViewer ? "Edit profile" : "Follow"}
          </Button>

          <Separator />

          <p className="text-sm text-muted-foreground">
            {profile.data
              ? `${profile.data.repositoryCount} repositories · ${profile.data.starCount} stars`
              : "No bio yet."}
          </p>
        </aside>

        <section className="flex flex-col gap-6">
          <ProfileTabs
            username={username}
            isViewer={isViewer}
            owners={viewer ? [viewer] : []}
            initialRepositories={data.repositories}
            initialCursor={data.nextCursor}
          />
        </section>
      </main>
    </div>
  );
}
