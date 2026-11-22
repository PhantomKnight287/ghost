import { useQuery } from "@tanstack/react-query";
import { ApiError, api, HOST, type Repositories, type Side } from "@/lib/api.ts";
import { linkGitHub } from "@/lib/auth-client.ts";
import { Button } from "../ui/button.tsx";
import { Select } from "../ui/field.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

/** Repositories the app is installed on and the person administers; ones already in a sync cannot be picked again. */
export function RepositoryPicker({ side, value, onChange }: { side: Side; value: string; onChange: (fullName: string) => void }) {
  const repositories = useQuery({ queryKey: ["repositories", side], queryFn: () => api<Repositories>(`/api/repositories/${side}`) });

  if (repositories.error) {
    const notLinked = repositories.error instanceof ApiError && repositories.error.status === 400;
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        <span>{repositories.error.message}</span>
        {notLinked && side === "github" && (
          <Button variant="secondary" onClick={() => linkGitHub()}>
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
      <Select aria-label={`${HOST[side]} repository`} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a {HOST[side]} repository</option>
        {choices.map((repo) => (
          <option key={repo.id} value={repo.fullName} disabled={repo.synced}>
            {repo.fullName}
            {repo.private ? " · private" : ""}
            {repo.synced ? " · already synced" : ""}
          </option>
        ))}
      </Select>
      <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
        Missing one?{" "}
        <a href={installUrl} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100">
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
