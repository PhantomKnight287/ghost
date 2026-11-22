import type { HTMLAttributes } from "react";

/** A bordered surface that groups one block of content. */
export function Panel({ as: Tag = "div", className = "", ...props }: HTMLAttributes<HTMLElement> & { as?: "div" | "section" }) {
  return <Tag className={`rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 ${className}`} {...props} />;
}
