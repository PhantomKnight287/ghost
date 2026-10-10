import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { SettingsNav } from "@/components/repositories/settings-nav";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { getServerSession } from "@/lib/api/server";

/** The signed-in account's settings, laid out as an organization's are: a sidebar of sections beside the one open. */
export default async function SettingsLayout({
  children,
}: LayoutProps<"/settings">) {
  const session = await getServerSession();
  const user = session?.user;
  if (!user?.username)
    redirect(`/auth/sign-in?redirectTo=${encodeURIComponent("/settings")}`);

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={user.username} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 md:px-6">
        <div className="flex items-center gap-3">
          <ProfileAvatar
            name={user.name || user.username}
            image={user.image}
            className="size-10"
          />
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold">
              {user.name || user.username}
            </h1>
            <Link
              href={`/${user.username}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              View profile
            </Link>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
          <SettingsNav
            label="Account settings"
            links={[
              { href: "/settings/account", label: "Account", icon: "account" },
              {
                href: "/settings/organizations",
                label: "Organizations",
                icon: "organizations",
              },
              { href: "/settings/storage", label: "Storage", icon: "storage" },
              {
                href: "/settings/security",
                label: "Password and sessions",
                icon: "security",
                group: "Access",
              },
              {
                href: "/settings/keys",
                label: "SSH and GPG keys",
                icon: "keys",
              },
              {
                href: "/settings/tokens",
                label: "Personal access tokens",
                icon: "tokens",
              },
              {
                href: "/settings/authorized-apps",
                label: "Authorized apps",
                icon: "authorizedApps",
                group: "Integrations",
              },
              {
                href: "/settings/oauth-apps",
                label: "OAuth apps",
                icon: "oauthApps",
                group: "Developer",
              },
            ]}
          />
          <div className="min-w-0 max-w-3xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
