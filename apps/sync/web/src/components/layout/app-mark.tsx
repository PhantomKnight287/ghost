import { SyncIcon } from "../ui/icons.tsx";

export function AppMark() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-6 place-items-center rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
        <SyncIcon width={14} height={14} />
      </span>
      Ghost Sync
    </span>
  );
}
