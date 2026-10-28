import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Button } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { createServerClient } from "@/lib/api/server";

const publicApp = cache(async (slug: string) => {
  const client = await createServerClient();
  const { data } = await client.GET("/api/apps/{slug}", {
    params: { path: { slug } },
  });
  return data;
});

export async function generateMetadata({
  params,
}: PageProps<"/apps/[slug]">): Promise<Metadata> {
  const app = await publicApp((await params).slug);
  return app
    ? { title: app.name, description: app.description ?? undefined }
    : {};
}

/** An app's public page: anyone with the link may read it and install the app. There is no directory of apps. */
export default async function PublicAppPage({
  params,
}: PageProps<"/apps/[slug]">) {
  const app = await publicApp((await params).slug);
  if (!app) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 md:px-6">
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        <ProfileAvatar
          name={app.name}
          image={app.logoUrl}
          className="size-20 rounded-2xl"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl font-semibold">{app.name}</h1>
          <p className="text-sm text-muted-foreground">
            By{" "}
            <Link
              href={`/${app.owner.login}`}
              className="font-medium text-foreground hover:underline"
            >
              {app.owner.login}
            </Link>
          </p>
        </div>
        <Button asChild>
          <Link href={app.installUrl}>Install</Link>
        </Button>
      </div>
      {app.description && (
        <p className="text-sm whitespace-pre-line">{app.description}</p>
      )}
      <a
        href={app.homepageUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:underline"
      >
        {app.homepageUrl}
        <ExternalLink className="size-3" />
      </a>
    </main>
  );
}
