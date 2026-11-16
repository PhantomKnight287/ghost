import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, type Sync } from "@/lib/api.ts";
import { Button } from "../ui/button.tsx";

/** Resync now, pause or resume, and delete, which asks once more and says neither repository is touched. */
export function SyncActions({ sync }: { sync: Sync }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const act = useMutation({
    mutationFn: (action: "resync" | "pause" | "resume" | "delete") =>
      action === "delete" ? api(`/api/syncs/${sync.id}`, { method: "DELETE" }) : api(`/api/syncs/${sync.id}/${action}`, { method: "POST" }),
    onSuccess: async (_, action) => {
      await queryClient.invalidateQueries({ queryKey: ["syncs"] });
      if (action === "delete") await navigate({ to: "/" });
      else await queryClient.invalidateQueries({ queryKey: ["sync", sync.id] });
    },
  });
  const paused = sync.status === "paused" || sync.status === "disconnected";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={act.isPending || paused} onClick={() => act.mutate("resync")}>
          Resync now
        </Button>
        <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate(paused ? "resume" : "pause")}>
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button variant="danger" disabled={act.isPending} onClick={() => setConfirmingDelete(true)}>
          Delete
        </Button>
      </div>
      {confirmingDelete && (
        <div className="flex flex-col gap-3 rounded-lg border border-red-300 p-4 text-sm dark:border-red-900">
          <p>
            Stop syncing <strong>{sync.ghostFullName}</strong> with <strong>{sync.githubFullName}</strong> and forget its history here? Both repositories are left exactly as they are.
          </p>
          <div className="flex gap-2">
            <Button variant="danger" disabled={act.isPending} onClick={() => act.mutate("delete")}>
              Delete sync
            </Button>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
      {act.error && <p className="text-sm text-red-600">{act.error.message}</p>}
    </div>
  );
}
