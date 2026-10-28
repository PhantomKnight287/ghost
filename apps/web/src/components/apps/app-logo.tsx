"use client";

import { useRouter } from "next/navigation";

import { ImageSetting } from "@/components/image-setting";

export function AppLogo({
  app,
}: {
  app: { slug: string; name: string; logoUrl: string | null };
}) {
  const router = useRouter();

  return (
    <ImageSetting
      title="Logo"
      hint="Shown on the app's page and as its bot's avatar beside everything it does. PNG or JPEG, square works best."
      name={app.name}
      image={app.logoUrl}
      path={`/api/apps/${app.slug}/logo`}
      onChanged={() => router.refresh()}
    />
  );
}
