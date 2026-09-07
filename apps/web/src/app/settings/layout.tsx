"use client";

import { useAuthenticate } from "@better-auth-ui/react";

import { AppHeader } from "@/components/app-header";
import { authClient } from "@/lib/auth-client";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const { data } = useAuthenticate(authClient);
  const username = data?.user.username ?? "";

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={username} owners={username ? [username] : []} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 md:px-6">
        {children}
      </main>
    </div>
  );
}
