import { useQuery } from "@tanstack/react-query";
import { ApiError, api, type Repositories, type Side } from "@/lib/api.ts";
import { linkGitHub } from "@/lib/auth-client.ts";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

const HOST = { ghost: "Ghost", github: "GitHub" } as const;

/** Repositories the app is installed on and the person administers; ones already in a sync cannot be picked again. */
export function RepositoryPicker({ side, value, onChange }: { side: Side; value: string; onChange: (fullName: string) => void }) {
  const repositories = useQuery({ queryKey: ["repositories", side], queryFn: () => api<Repositories>(`/api/repositories/${side}`) });

  if (repositories.error) {
    const notLinked = repositories.error instanceof ApiError && repositories.error.status === 400;
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-neutral-500">{repositories.error.message}</span>
        {notLinked && side === "github" && (
          <Button variant="outline" onClick={() => linkGitHub()}>
            Connect GitHub
          </Button>
        )}
      </div>
    );
  }
  if (!repositories.data) return <RepositoryPickerSkeleton />;

  const { repositories: choices, installUrl } = repositories.data;
  return (
    <div className="flex flex-col gap-2">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
      >
        <option value="">Choose a {HOST[side]} repository</option>
        {choices.map((repo) => (
          <option key={repo.id} value={repo.fullName} disabled={repo.synced}>
            {repo.fullName}
            {repo.private ? " (private)" : ""}
            {repo.synced ? " (already synced)" : ""}
          </option>
        ))}
      </select>
      <p className="text-sm text-neutral-500">
        Missing one?{" "}
        <a href={installUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
          Install the app on {HOST[side]}
        </a>
        , then come back.
      </p>
    </div>
  );
}

function RepositoryPickerSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-4 w-56" />
    </div>
  );
}
