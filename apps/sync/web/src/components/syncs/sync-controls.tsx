import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Sync } from "@/lib/api.ts";
import { Button } from "../ui/button.tsx";

/** Resync now, and pause or resume: the page header's actions. */
export function SyncControls({ sync }: { sync: Sync }) {
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (action: "resync" | "pause" | "resume") => api(`/api/syncs/${sync.id}/${action}`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["syncs"] });
      await queryClient.invalidateQueries({ queryKey: ["sync", sync.id] });
    },
  });
  const stopped = sync.status === "paused" || sync.status === "disconnected";

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex gap-2">
        <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate(stopped ? "resume" : "pause")}>
          {stopped ? "Resume" : "Pause"}
        </Button>
        <Button disabled={act.isPending || stopped} onClick={() => act.mutate("resync")}>
          {act.isPending && act.variables === "resync" ? "Queued…" : "Resync now"}
        </Button>
      </div>
      {act.error && <p className="text-[13px] text-red-600 dark:text-red-400">{act.error.message}</p>}
    </div>
  );
}
