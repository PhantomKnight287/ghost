import type { ReactNode } from "react";
import { authClient, signInWithGhost } from "@/lib/auth-client.ts";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { AppHeader } from "./app-header.tsx";

/** Shows its page to a signed-in person, under the header; everyone else gets the landing page. */
export function SignedIn({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <SignedInSkeleton />;
  if (!session) return <Landing />;
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}

function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">sync.ghost</h1>
      <p className="text-balance text-neutral-500">
        Keep a Ghost repository and a GitHub repository in step, both ways: code, pull requests, issues, reviews and checks. Nothing is ever overwritten on its own.
      </p>
      <Button onClick={() => signInWithGhost()}>Sign in with Ghost</Button>
    </main>
  );
}

function SignedInSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Skeleton className="mb-8 h-9 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
