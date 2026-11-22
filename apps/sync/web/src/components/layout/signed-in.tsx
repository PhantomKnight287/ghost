import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client.ts";
import { Skeleton } from "../ui/skeleton.tsx";
import { AppHeader } from "./app-header.tsx";
import { Landing } from "./landing.tsx";

/** Shows its page to a signed-in person, under the header; everyone else gets the landing page. */
export function SignedIn({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <SignedInSkeleton />;
  if (!session) return <Landing />;
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
    </>
  );
}

function SignedInSkeleton() {
  return (
    <>
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    </>
  );
}
