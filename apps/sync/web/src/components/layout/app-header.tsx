import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type Me } from "@/lib/api.ts";
import { authClient, linkGitHub } from "@/lib/auth-client.ts";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { AppMark } from "./app-mark.tsx";

/** Who is signed in, and whether GitHub is linked yet: nothing can be synced until it is. */
export function AppHeader() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me") });

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link to="/" aria-label="Your syncs">
          <AppMark />
        </Link>
        {me.data ? (
          <div className="flex items-center gap-1 text-[13px]">
            <dl className="mr-2 hidden items-center gap-4 text-zinc-500 sm:flex">
              <div className="flex gap-1.5">
                <dt>Ghost</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-100">@{me.data.ghost?.login}</dd>
              </div>
              {me.data.github && (
                <div className="flex gap-1.5">
                  <dt>GitHub</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">@{me.data.github.login}</dd>
                </div>
              )}
            </dl>
            {!me.data.github && (
              <Button variant="secondary" onClick={() => linkGitHub()}>
                Connect GitHub
              </Button>
            )}
            <Button variant="ghost" onClick={() => authClient.signOut().then(() => window.location.assign("/"))}>
              Sign out
            </Button>
          </div>
        ) : (
          <AppHeaderSkeleton />
        )}
      </div>
    </header>
  );
}

function AppHeaderSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="hidden h-4 w-48 sm:block" />
      <Skeleton className="h-8 w-20" />
    </div>
  );
}
