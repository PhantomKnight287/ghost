"use client";

import { cn } from "cn";
import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Loader,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import {
  loadCheckAnnotations,
  pressCheckAction,
  rerunCheckRun,
  rerunCheckSuite,
} from "@/components/repositories/check-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { components } from "@/lib/api/v1";

type CheckRun = components["schemas"]["CheckRunDTO"];
type Annotation = components["schemas"]["CheckAnnotationDTO"];

const annotationTone = {
  failure: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  notice: "text-sky-600 dark:text-sky-400",
} satisfies Record<Annotation["annotationLevel"], string>;

export function CheckRunIcon({
  run,
  className,
}: {
  run: Pick<CheckRun, "status" | "conclusion">;
  className?: string;
}) {
  const icon = cn("size-4 shrink-0", className);
  if (run.status === "queued")
    return (
      <CircleDashed
        aria-label="Queued"
        className={cn(icon, "text-amber-500")}
      />
    );
  if (run.status === "in_progress")
    return (
      <Loader
        aria-label="In progress"
        className={cn(
          icon,
          "animate-spin text-amber-500 motion-reduce:animate-none",
        )}
      />
    );
  if (run.conclusion === "success")
    return (
      <CircleCheck
        aria-label="Passed"
        className={cn(icon, "text-emerald-500")}
      />
    );
  if (run.conclusion === "neutral" || run.conclusion === "skipped")
    return (
      <CircleSlash
        aria-label={run.conclusion === "neutral" ? "Neutral" : "Skipped"}
        className={cn(icon, "text-muted-foreground")}
      />
    );
  return (
    <CircleX
      aria-label={run.conclusion?.replace("_", " ") ?? "Failed"}
      className={cn(icon, "text-red-500")}
    />
  );
}

/** One check run that expands in place into its output, its annotations (fetched on first open) and, for a writer, its re-run and action buttons. */
export function CheckRunRow({
  run,
  repository,
  required,
  canRerun,
  rerunAll,
}: {
  run: CheckRun;
  repository: { username: string; repo: string };
  required: boolean;
  canRerun: boolean;
  /** Offer "Re-run all" for the run's suite: set on each app's first row. */
  rerunAll: boolean;
}) {
  const router = useRouter();
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const onDone = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      router.refresh();
    },
    onError: ({ error }: { error: { serverError?: string } }) =>
      toast.error(error.serverError ?? "Could not reach the app."),
  });
  const rerun = useAction(
    rerunCheckRun,
    onDone(`Asked ${run.app.name} to re-run ${run.name}.`),
  );
  const rerunSuite = useAction(
    rerunCheckSuite,
    onDone(`Asked ${run.app.name} to re-run its checks.`),
  );
  const press = useAction(pressCheckAction, onDone(`Sent to ${run.app.name}.`));
  const load = useAction(loadCheckAnnotations, {
    onSuccess: ({ data }) =>
      data &&
      setAnnotations((shown) => [...(shown ?? []), ...data.annotations]),
    onError: () => toast.error("Could not load the annotations."),
  });
  const target = { ...repository, id: run.id };
  const hasOutput =
    run.output.summary || run.output.text || run.output.annotationsCount > 0;

  return (
    <li>
      <details
        className="group/run"
        onToggle={(event) => {
          if (
            event.currentTarget.open &&
            annotations === null &&
            run.output.annotationsCount > 0
          )
            load.execute({ ...target, offset: 0 });
        }}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <CheckRunIcon run={run} />
          <span className="shrink-0 font-medium">
            <span className="text-muted-foreground">{run.app.slug} / </span>
            {run.name}
          </span>
          {required && (
            <Badge variant="outline" className="shrink-0">
              Required
            </Badge>
          )}
          {run.output.title && (
            <span
              title={run.output.title}
              className="min-w-0 truncate text-muted-foreground"
            >
              {run.output.title}
            </span>
          )}
          {canRerun && rerunAll && (
            <Button
              variant="link"
              size="sm"
              className="ml-auto h-auto shrink-0 p-0 text-xs"
              disabled={rerunSuite.isPending}
              onClick={(event) => {
                event.preventDefault();
                rerunSuite.execute({ ...repository, id: run.suiteId });
              }}
            >
              Re-run all
            </Button>
          )}
        </summary>
        <div className="mt-2 mb-3 ml-6 flex flex-col gap-3 border-l pl-3">
          {run.output.summary && (
            <Markdown repository={repository}>{run.output.summary}</Markdown>
          )}
          {run.output.text && (
            <Markdown repository={repository}>{run.output.text}</Markdown>
          )}
          {!hasOutput && (
            <p className="text-muted-foreground">
              {run.app.name} reported no output.
            </p>
          )}
          {annotations && annotations.length > 0 && (
            <ul className="flex flex-col gap-1 font-mono text-xs">
              {annotations.map((annotation, index) => (
                <li key={`${annotation.path}:${annotation.startLine}:${index}`}>
                  <span className={annotationTone[annotation.annotationLevel]}>
                    {annotation.path}:{annotation.startLine}
                    {annotation.endLine !== annotation.startLine &&
                      `-${annotation.endLine}`}
                  </span>{" "}
                  <span className="font-sans">
                    {annotation.title && <strong>{annotation.title}: </strong>}
                    {annotation.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {annotations && annotations.length < run.output.annotationsCount && (
            <Button
              variant="link"
              size="sm"
              className="h-auto self-start p-0 text-xs"
              disabled={load.isPending}
              onClick={() =>
                load.execute({ ...target, offset: annotations.length })
              }
            >
              Show {run.output.annotationsCount - annotations.length} more
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {canRerun && (
              <Button
                variant="outline"
                size="sm"
                disabled={rerun.isPending}
                onClick={() => rerun.execute(target)}
              >
                Re-run
              </Button>
            )}
            {canRerun &&
              run.actions.map((action) => (
                <Button
                  key={action.identifier}
                  variant="outline"
                  size="sm"
                  title={action.description}
                  disabled={press.isPending}
                  onClick={() =>
                    press.execute({ ...target, identifier: action.identifier })
                  }
                >
                  {action.label}
                </Button>
              ))}
            {run.detailsUrl && (
              <a
                href={run.detailsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:underline"
              >
                Details ↗
              </a>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}
