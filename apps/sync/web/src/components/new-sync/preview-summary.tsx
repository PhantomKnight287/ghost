import { useQuery } from "@tanstack/react-query";
import { api, type Preview } from "@/lib/api.ts";
import { Callout } from "../ui/callout.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

/** What the first sync will copy each way. Nothing is overwritten: branches that differ on both sides are left alone and flagged. */
export function PreviewSummary({ ghost, github }: { ghost: string; github: string }) {
  const preview = useQuery({
    queryKey: ["preview", ghost, github],
    queryFn: () => api<Preview>("/api/syncs/preview", { method: "POST", body: { ghost: { fullName: ghost }, github: { fullName: github } } }),
  });

  if (preview.error) return <Callout tone="danger" title="The preview could not be built">{preview.error.message}</Callout>;
  if (!preview.data) return <PreviewSummarySkeleton />;

  const { branches, issues, pulls } = preview.data;
  const rows: [string, number, number][] = [
    ["Branches and tags", branches.toGitHub, branches.toGhost],
    ["Issues", issues.toGitHub, issues.toGhost],
    ["Pull requests", pulls.toGitHub, pulls.toGhost],
  ];
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 text-left font-medium">Copied</th>
            <th className="py-2 text-right font-medium">To GitHub</th>
            <th className="py-2 text-right font-medium">To Ghost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {rows.map(([label, toGitHub, toGhost]) => (
            <tr key={label}>
              <td className="py-2">{label}</td>
              <td className={`py-2 text-right tabular-nums ${toGitHub ? "font-medium" : "text-zinc-400"}`}>{toGitHub}</td>
              <td className={`py-2 text-right tabular-nums ${toGhost ? "font-medium" : "text-zinc-400"}`}>{toGhost}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {branches.diverged > 0 && (
        <Callout tone="warning" title={branches.diverged === 1 ? "1 branch differs on both sides" : `${branches.diverged} branches differ on both sides`}>
          They are left alone and flagged until someone makes them agree.
        </Callout>
      )}
    </div>
  );
}

function PreviewSummarySkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
    </div>
  );
}
