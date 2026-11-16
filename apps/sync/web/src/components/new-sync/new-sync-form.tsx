import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, api, type NewSync } from "@/lib/api.ts";
import { Button } from "../ui/button.tsx";
import { type NewRepository, NewGitHubRepository } from "./new-github-repository.tsx";
import { PreviewSummary } from "./preview-summary.tsx";
import { RepositoryPicker } from "./repository-picker.tsx";

/** One page: a Ghost repository, an existing or new GitHub one, what the first sync will do, and "Start sync". */
export function NewSyncForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ghost, setGhost] = useState("");
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [github, setGithub] = useState("");
  const [created, setCreated] = useState<NewRepository>({ owner: "", name: "", private: true });

  const start = useMutation({
    mutationFn: (body: NewSync) => api<{ id: string; installUrl?: string }>("/api/syncs", { method: "POST", body }),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ["syncs"] });
      await navigate({ to: "/syncs/$id", params: { id } });
    },
  });

  const ready = ghost !== "" && (mode === "existing" ? github !== "" : created.owner !== "" && created.name.trim() !== "");
  const submit = () =>
    start.mutate({ ghost: { fullName: ghost }, github: mode === "existing" ? { fullName: github } : { create: { ...created, name: created.name.trim() } } });

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Ghost repository</h2>
        <RepositoryPicker side="ghost" value={ghost} onChange={setGhost} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">GitHub repository</h2>
        <fieldset className="flex gap-4 text-sm">
          {(["existing", "create"] as const).map((choice) => (
            <label key={choice} className="flex items-center gap-2">
              <input type="radio" name="github-mode" checked={mode === choice} onChange={() => setMode(choice)} />
              {choice === "existing" ? "Existing" : "Create new"}
            </label>
          ))}
        </fieldset>
        {mode === "existing" ? <RepositoryPicker side="github" value={github} onChange={setGithub} /> : <NewGitHubRepository value={created} onChange={setCreated} />}
      </section>

      {ghost && mode === "existing" && github && <PreviewSummary ghost={ghost} github={github} />}

      {start.error && (
        <p className="text-sm text-red-600">
          {start.error.message}{" "}
          {start.error instanceof ApiError && start.error.installUrl && (
            <a href={start.error.installUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              Install the app
            </a>
          )}
        </p>
      )}
      <div>
        <Button disabled={!ready || start.isPending} onClick={submit}>
          {start.isPending ? "Starting…" : "Start sync"}
        </Button>
      </div>
    </div>
  );
}
