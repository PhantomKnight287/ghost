import { notFound } from "next/navigation";

import { SettingsNav } from "@/components/repositories/settings-nav";
import { getViewerRole } from "@/lib/api/server";
import { atLeast } from "@ghost/permissions";

export default async function RepositorySettingsLayout({
  params,
  children,
}: LayoutProps<"/[username]/[repo]/settings">) {
  const { username, repo } = await params;
  const role = await getViewerRole(username, repo);

  // The API enforces every change; this keeps everyone else from seeing forms they cannot submit.
  if (!atLeast(role, "maintain")) notFound();
  const base = `/${username}/${repo}/settings`;

  return (
    <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
      <SettingsNav
        label="Repository settings"
        links={[
          { href: base, label: "General", icon: "settings" },
          ...(atLeast(role, "admin")
            ? [
                {
                  href: `${base}/collaborators`,
                  label: "Access",
                  icon: "users" as const,
                },
              ]
            : []),
        ]}
      />
      <div className="min-w-0 max-w-3xl">{children}</div>
    </div>
  );
}
