import type { ReactNode } from "react";
import { AlertIcon } from "./icons.tsx";

const TONES = {
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
  danger: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200",
} as const;

/** A boxed notice for something a person has to act on. */
export function Callout({ tone, title, children }: { tone: keyof typeof TONES; title: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}>
      <AlertIcon className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">{title}</p>
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}
