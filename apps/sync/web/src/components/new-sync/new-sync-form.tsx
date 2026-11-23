import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, api, type NewSync } from "@/lib/api.ts";
import { Button, buttonClass } from "../ui/button.tsx";
import { Callout } from "../ui/callout.tsx";
import { Panel } from "../ui/panel.tsx";
import { Segmented } from "../ui/segmented.tsx";
import { type NewRepository, NewGitHubRepository } from "./new-github-repository.tsx";
import { PreviewSummary } from "./preview-summary.tsx";
import { RepositoryPicker } from "./repository-picker.tsx";
import { Step } from "./step.tsx";

/** One page: a Ghost repository, an existing or new GitHub one, what the first sync will do, and "Start sync". */
export function NewSyncForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ghost, setGhost] = useState("");
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [github, setGithub] = useState("");
  const [created, setCreated] = useState<NewRepository>({ owner: "", name: "", private: true });
  const [skipHistory, setSkipHistory] = useState(false);

  const start = useMutation({
    mutationFn: (body: NewSync) => api<{ id: string; installUrl?: string }>("/api/syncs", { method: "POST", body }),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ["syncs"] });
      await navigate({ to: "/syncs/$id", params: { id } });
    },
  });

  const ready = ghost !== "" && (mode === "existing" ? github !== "" : created.owner !== "" && created.name.trim() !== "");
  const submit = () =>
    start.mutate({
      ghost: { fullName: ghost },
      github: mode === "existing" ? { fullName: github } : { create: { ...created, name: created.name.trim() } },
      backfill: !skipHistory,
    });

  return (
    <Panel className="divide-y divide-zinc-200 dark:divide-zinc-800">
      <Step number={1} title="Ghost repository" hint="Repositories the app is installed on and you administer.">
        <RepositoryPicker side="ghost" value={ghost} onChange={setGhost} />
      </Step>

      <Step
        number={2}
        title="GitHub repository"
        hint={mode === "existing" ? "Pick one the app can reach, or start an empty one." : "Created empty, so the first sync fills it from Ghost."}
        aside={
          <Segmented
            label="GitHub repository"
            value={mode}
            onChange={setMode}
            options={[
              { value: "existing", label: "Existing" },
              { value: "create", label: "Create new" },
            ]}
          />
        }
      >
        {mode === "existing" ? <RepositoryPicker side="github" value={github} onChange={setGithub} /> : <NewGitHubRepository value={created} onChange={setCreated} />}
      </Step>

      <Step number={3} title="Review" hint={skipHistory ? "Only what happens from now on is copied." : "What the first sync will copy each way."}>
        <label className="mb-4 flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={skipHistory} onChange={(event) => setSkipHistory(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-zinc-900 dark:accent-zinc-100" />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Skip history</span>
            <span className="text-[13px] text-zinc-500 dark:text-zinc-400">Existing branches, issues, pull requests and comments stay where they are. Only pushes, issues, comments and reviews from after the sync starts are copied.</span>
          </span>
        </label>
        {skipHistory ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing is copied when the sync starts. An existing branch, issue or pull request is copied once someone works on it, without its earlier comments.</p>
        ) : ghost && mode === "existing" && github ? (
          <PreviewSummary ghost={ghost} github={github} />
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{mode === "create" ? "The new repository starts empty: everything on Ghost is copied to it." : "Pick both repositories to see what will be copied."}</p>
        )}
      </Step>

      <div className="flex flex-col gap-3 bg-zinc-50 px-6 py-4 dark:bg-zinc-900">
        {start.error && (
          <Callout tone="danger" title="The sync was not started">
            {start.error.message}{" "}
            {start.error instanceof ApiError && start.error.installUrl && (
              <a href={start.error.installUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                Install the app
              </a>
            )}
          </Callout>
        )}
        <div className="flex justify-end gap-2">
          <Link to="/" className={buttonClass("ghost")}>
            Cancel
          </Link>
          <Button disabled={!ready || start.isPending} onClick={submit}>
            {start.isPending ? "Starting…" : "Start sync"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
