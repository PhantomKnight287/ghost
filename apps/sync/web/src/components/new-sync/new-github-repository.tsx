import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api.ts";
import { Input, Select } from "../ui/field.tsx";
import { Segmented } from "../ui/segmented.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

export type NewRepository = { owner: string; name: string; private: boolean };

/** Where a new, empty GitHub repository goes: the person, or an organization they administer. Private unless they choose otherwise. */
export function NewGitHubRepository({ value, onChange }: { value: NewRepository; onChange: (next: NewRepository) => void }) {
  const owners = useQuery({ queryKey: ["github-owners"], queryFn: () => api<{ owners: string[] }>("/api/github/owners") });

  if (owners.error) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{owners.error.message}</p>;
  if (!owners.data) return <NewGitHubRepositorySkeleton />;

  const owner = value.owner || owners.data.owners[0] || "";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-[12rem_auto_minmax(0,1fr)] sm:items-center">
        <Select aria-label="Owner" value={owner} onChange={(event) => onChange({ ...value, owner: event.target.value })}>
          {owners.data.owners.map((login) => (
            <option key={login} value={login}>
              {login}
            </option>
          ))}
        </Select>
        <span className="hidden text-zinc-400 sm:inline">/</span>
        <Input aria-label="Repository name" value={value.name} onChange={(event) => onChange({ ...value, owner, name: event.target.value })} placeholder="repository-name" />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-zinc-500 dark:text-zinc-400">Visibility</span>
        <Segmented
          label="Visibility"
          value={value.private ? "private" : "public"}
          onChange={(next) => onChange({ ...value, owner, private: next === "private" })}
          options={[
            { value: "private", label: "Private" },
            { value: "public", label: "Public" },
          ]}
        />
      </div>
    </div>
  );
}

function NewGitHubRepositorySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-7 w-48" />
    </div>
  );
}
