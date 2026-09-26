import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { SettingsNav } from "@/components/repositories/settings-nav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  createServerClient,
  getAdminOrganizations,
  getServerSession,
} from "@/lib/api/server";

/** An organization's settings, for its admins; everyone else has its profile at `/<slug>`. A user's settings live at `/settings`, so a username here goes there. */
export default async function OrganizationSettingsLayout({
  params,
  children,
}: LayoutProps<"/[username]/settings">) {
  const { username: slug } = await params;
  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);
  const viewer = session?.user.username;
  if (!viewer) {
    redirect(
      `/auth/sign-in?redirectTo=${encodeURIComponent(`/${slug}/settings`)}`,
    );
  }

  const [profile, administered] = await Promise.all([
    client.GET("/api/organizations/{slug}", { params: { path: { slug } } }),
    getAdminOrganizations(),
  ]);
  if (!profile.data) {
    if (slug === viewer) redirect("/settings");
    notFound();
  }
  if (!administered.includes(slug)) notFound();

  const base = `/${slug}/settings`;
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={[viewer]} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 md:px-6">
        <div className="flex items-center gap-3">
          <Avatar className="size-10 rounded-lg">
            <AvatarImage src={profile.data.logo ?? undefined} alt="" />
            <AvatarFallback>{slug.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold">{profile.data.name}</h1>
            <Link
              href={`/${slug}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              View profile
            </Link>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
          <SettingsNav
            label="Organization settings"
            links={[
              { href: base, label: "General", icon: "settings" },
              { href: `${base}/people`, label: "People", icon: "users" },
              { href: `${base}/teams`, label: "Teams", icon: "teams" },
              {
                href: `${base}/outside-collaborators`,
                label: "Outside collaborators",
                icon: "outside",
              },
            ]}
          />
          <div className="min-w-0 max-w-3xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
