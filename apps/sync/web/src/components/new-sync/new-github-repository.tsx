import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api.ts";
import { Skeleton } from "../ui/skeleton.tsx";

export type NewRepository = { owner: string; name: string; private: boolean };

/** Where a new, empty GitHub repository goes: the person, or an organization they administer. Private unless they choose otherwise. */
export function NewGitHubRepository({ value, onChange }: { value: NewRepository; onChange: (next: NewRepository) => void }) {
  const owners = useQuery({ queryKey: ["github-owners"], queryFn: () => api<{ owners: string[] }>("/api/github/owners") });

  if (owners.error) return <p className="text-sm text-neutral-500">{owners.error.message}</p>;
  if (!owners.data) return <NewGitHubRepositorySkeleton />;

  const owner = value.owner || owners.data.owners[0] || "";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={owner}
          onChange={(event) => onChange({ ...value, owner: event.target.value })}
          className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        >
          {owners.data.owners.map((login) => (
            <option key={login} value={login}>
              {login}
            </option>
          ))}
        </select>
        <span className="hidden text-neutral-500 sm:inline">/</span>
        <input
          value={value.name}
          onChange={(event) => onChange({ ...value, owner, name: event.target.value })}
          placeholder="repository-name"
          className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
      </div>
      <fieldset className="flex gap-4 text-sm">
        {[true, false].map((isPrivate) => (
          <label key={String(isPrivate)} className="flex items-center gap-2">
            <input type="radio" name="visibility" checked={value.private === isPrivate} onChange={() => onChange({ ...value, owner, private: isPrivate })} />
            {isPrivate ? "Private" : "Public"}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function NewGitHubRepositorySkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}
