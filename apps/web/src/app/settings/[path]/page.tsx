import { viewPaths } from "@better-auth-ui/core";
import { notFound } from "next/navigation";

import { Settings } from "@/components/auth/settings/settings";

const validSettingsPaths = new Set(Object.values(viewPaths.settings));

export default async function SettingsPage({
  params,
}: PageProps<"/settings/[path]">) {
  const { path } = await params;

  if (!validSettingsPaths.has(path)) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <Settings path={path} />
    </div>
  );
}
