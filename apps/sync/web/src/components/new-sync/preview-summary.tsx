import { useQuery } from "@tanstack/react-query";
import { api, type Preview } from "@/lib/api.ts";
import { Skeleton } from "../ui/skeleton.tsx";

/** What the first sync will copy each way. Nothing is overwritten: branches that differ on both sides are left alone and flagged. */
export function PreviewSummary({ ghost, github }: { ghost: string; github: string }) {
  const preview = useQuery({
    queryKey: ["preview", ghost, github],
    queryFn: () => api<Preview>("/api/syncs/preview", { method: "POST", body: { ghost: { fullName: ghost }, github: { fullName: github } } }),
  });

  if (preview.error) return <p className="text-sm text-red-600">{preview.error.message}</p>;
  if (!preview.data) return <PreviewSummarySkeleton />;

  const { branches, issues, pulls } = preview.data;
  const rows: [string, number, number][] = [
    ["Branches and tags", branches.toGitHub, branches.toGhost],
    ["Issues", issues.toGitHub, issues.toGhost],
    ["Pull requests", pulls.toGitHub, pulls.toGhost],
  ];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <h3 className="font-medium">What the first sync will do</h3>
      <table className="w-full text-left">
        <thead className="text-neutral-500">
          <tr>
            <th className="py-1 font-normal" />
            <th className="py-1 font-normal">To GitHub</th>
            <th className="py-1 font-normal">To Ghost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, toGitHub, toGhost]) => (
            <tr key={label}>
              <td className="py-1">{label}</td>
              <td className="py-1 tabular-nums">{toGitHub}</td>
              <td className="py-1 tabular-nums">{toGhost}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {branches.diverged > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          {branches.diverged} {branches.diverged === 1 ? "branch differs" : "branches differ"} on both sides and will be left alone and flagged until someone makes them agree.
        </p>
      )}
    </div>
  );
}

function PreviewSummarySkeleton() {
  return <Skeleton className="h-36 w-full" />;
}
