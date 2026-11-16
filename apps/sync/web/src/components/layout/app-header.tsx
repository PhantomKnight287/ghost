import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type Me } from "@/lib/api.ts";
import { authClient, linkGitHub } from "@/lib/auth-client.ts";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

/** Who is signed in, and whether GitHub is linked yet: nothing can be synced until it is. */
export function AppHeader() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me") });

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className="font-semibold">
          sync.ghost
        </Link>
        {me.data ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-neutral-500">Ghost @{me.data.ghost?.login}</span>
            {me.data.github ? (
              <span className="text-neutral-500">GitHub @{me.data.github.login}</span>
            ) : (
              <Button variant="outline" onClick={() => linkGitHub()}>
                Connect GitHub
              </Button>
            )}
            <Button variant="outline" onClick={() => authClient.signOut().then(() => window.location.assign("/"))}>
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
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-9 w-20" />
    </div>
  );
}
