import type { ReactNode } from "react";

/** One numbered question of the new-sync form, with what it is for and an optional control on the right. */
export function Step({ number, title, hint, aside, children }: { number: number; title: string; hint: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full border border-zinc-300 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{number}</span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-medium">{title}</h2>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{hint}</p>
          </div>
        </div>
        {aside}
      </div>
      <div className="sm:pl-9">{children}</div>
    </section>
  );
}
