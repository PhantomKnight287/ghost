import { cn } from "cn";
import { CircleX, Info, TriangleAlert } from "lucide-react";

import type { components } from "@/lib/api/v1";

type Annotation = components["schemas"]["CheckAnnotationDTO"];

const levels = {
  failure: {
    icon: CircleX,
    label: "Check failure",
    tone: "border-red-500/60 bg-red-500/5 text-red-700 dark:text-red-300",
  },
  warning: {
    icon: TriangleAlert,
    label: "Check warning",
    tone: "border-amber-500/60 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  },
  notice: {
    icon: Info,
    label: "Check notice",
    tone: "border-sky-500/60 bg-sky-500/5 text-sky-700 dark:text-sky-300",
  },
} satisfies Record<Annotation["annotationLevel"], unknown>;

/** A check run's annotation under the diff line it points at. */
export function CheckAnnotation({
  annotation,
  run,
}: {
  annotation: Annotation;
  run: { name: string; appSlug: string };
}) {
  const level = levels[annotation.annotationLevel];
  const Icon = level.icon;
  return (
    <div
      className={cn(
        "mx-2 my-1 rounded-md border border-l-4 px-3 py-2 font-sans text-sm",
        level.tone,
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5 shrink-0" />
        {level.label}
        <span className="text-muted-foreground">
          · {run.appSlug} / {run.name}
        </span>
      </p>
      {annotation.title && (
        <p className="mt-1 font-medium text-foreground">{annotation.title}</p>
      )}
      <p className="mt-1 whitespace-pre-wrap text-foreground">
        {annotation.message}
      </p>
      {annotation.rawDetails && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Details
          </summary>
          <pre className="mt-1 overflow-x-auto text-xs text-foreground">
            {annotation.rawDetails}
          </pre>
        </details>
      )}
    </div>
  );
}
