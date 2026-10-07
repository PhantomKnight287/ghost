"use client";

import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { useAuthenticate } from "@/lib/auth/use-authenticate";
import { authClient } from "@/lib/auth-client";

/** A page only a signed-in user can see: the app header over the page, with a visitor sent to sign in. */
export function SignedInLayout({ children }: { children: ReactNode }) {
  const { data } = useAuthenticate(authClient);
  const username = data?.user.username ?? "";

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={username} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 md:px-6">
        {children}
      </main>
    </div>
  );
}
