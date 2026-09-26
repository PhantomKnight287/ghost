import { viewPaths } from "@better-auth-ui/core";
import { notFound } from "next/navigation";

import { Settings } from "@/components/auth/settings/settings";

// Plugins add their own tabs, and the organization plugin's is `organizations`.
const validSettingsPaths = new Set([
  ...Object.values(viewPaths.settings),
  "organizations",
]);

export default async function SettingsPage({
  params,
}: PageProps<"/settings/[path]">) {
  const { path } = await params;

  if (!validSettingsPaths.has(path)) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Settings path={path} />
    </div>
  );
}
