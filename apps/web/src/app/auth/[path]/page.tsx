import { viewPaths } from "@better-auth-ui/core";
import { notFound } from "next/navigation";

import { Auth } from "@/components/auth/auth";

// The organization plugin adds the page an emailed invitation links to.
const validAuthPaths = new Set([
  ...Object.values(viewPaths.auth),
  "accept-invitation",
]);

export default async function AuthPage({ params }: PageProps<"/auth/[path]">) {
  const { path } = await params;

  if (!validAuthPaths.has(path)) {
    notFound();
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4 md:p-6">
      <Auth path={path} />
    </div>
  );
}
