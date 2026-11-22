import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "../ui/icons.tsx";

export function BackToSyncs() {
  return (
    <Link to="/" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
      <ArrowLeftIcon width={14} height={14} /> Syncs
    </Link>
  );
}
