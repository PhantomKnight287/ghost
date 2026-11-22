import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, type Sync } from "@/lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Panel } from "../ui/panel.tsx";

/** Deleting asks once more and says neither repository is touched. */
export function DeleteSync({ sync }: { sync: Sync }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/api/syncs/${sync.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["syncs"] });
      await navigate({ to: "/" });
    },
  });

  return (
    <Panel as="section" className="border-red-200 dark:border-red-900/50">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Delete this sync</h2>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">Stops syncing and forgets its history here. Both repositories are left exactly as they are.</p>
        </div>
        {!confirming && (
          <Button variant="secondary" className="text-red-600 dark:text-red-400" onClick={() => setConfirming(true)}>
            Delete sync
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-col gap-3 border-t border-red-200 bg-red-50/60 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-red-900/50 dark:bg-red-950/20">
          <p className="text-[13px]">
            Stop syncing <strong className="font-medium">{sync.ghostFullName}</strong> with <strong className="font-medium">{sync.githubFullName}</strong>?
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? "Deleting…" : "Yes, delete"}
            </Button>
          </div>
        </div>
      )}
      {remove.error && <p className="px-5 pb-4 text-[13px] text-red-600 dark:text-red-400">{remove.error.message}</p>}
    </Panel>
  );
}
