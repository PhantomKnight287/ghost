import { HOST, type Side } from "@/lib/api.ts";
import { ExternalIcon, SyncIcon } from "../ui/icons.tsx";

/** The two repositories of a sync, each under its host's name. With `webUrl` each one links to its page on the host. */
export function RepositoryPair({ ghost, github, webUrl, size = "md" }: { ghost: string; github: string; webUrl?: Record<Side, string>; size?: "md" | "lg" }) {
  const names: [Side, string][] = [
    ["ghost", ghost],
    ["github", github],
  ];
  return (
    <div className={`flex min-w-0 flex-col gap-x-3 gap-y-1 sm:flex-row sm:items-end ${size === "lg" ? "sm:gap-x-4" : ""}`}>
      {names.map(([side, fullName], index) => (
        <div key={side} className="flex min-w-0 items-end gap-3">
          {index === 1 && <SyncIcon className="mb-1 hidden shrink-0 text-zinc-400 sm:block" />}
          <div className="flex min-w-0 flex-col">
            <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{HOST[side]}</span>
            {webUrl ? (
              <a href={`${webUrl[side]}/${fullName}`} target="_blank" rel="noreferrer" className={`group inline-flex min-w-0 items-center gap-1.5 hover:underline ${size === "lg" ? "text-xl font-semibold tracking-tight" : "font-medium"}`}>
                <span className="break-all sm:truncate">{fullName}</span>
                <ExternalIcon width={14} height={14} className="shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            ) : (
              <span className={`break-all sm:truncate ${size === "lg" ? "text-xl font-semibold tracking-tight" : "font-medium"}`}>{fullName}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
