"use client";

import { useRouter } from "next/navigation";

import { ImageSetting } from "@/components/image-setting";

export function OauthAppLogo({
  app,
}: {
  app: { clientId: string; name: string; logoUrl: string | null };
}) {
  const router = useRouter();

  return (
    <ImageSetting
      title="Logo"
      hint="Shown to people when your app asks for access, so they recognise it. PNG or JPEG, square works best."
      name={app.name}
      image={app.logoUrl}
      path={`/api/oauth-apps/${app.clientId}/logo`}
      onChanged={() => router.refresh()}
    />
  );
}
