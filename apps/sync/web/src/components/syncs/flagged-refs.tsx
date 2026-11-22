import type { FlaggedRef } from "@/lib/api.ts";
import { Callout } from "../ui/callout.tsx";

const short = (sha: string | null) => sha?.slice(0, 7) ?? "deleted";

/** Branches and tags left alone because both sides changed, or a push was refused; they sync again once a person makes them agree. */
export function FlaggedRefs({ refs }: { refs: FlaggedRef[] }) {
  if (refs.length === 0) return null;
  return (
    <Callout tone="warning" title={refs.length === 1 ? "1 branch needs a person" : `${refs.length} branches need a person`}>
      <p>Both sides changed these, so neither was overwritten. Merge one side into the other and syncing resumes.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {refs.map((ref) => (
          <li key={ref.name} className="flex flex-col gap-0.5 rounded-md bg-white/60 px-3 py-2 dark:bg-black/20">
            <span className="font-mono text-[13px] font-medium">{ref.name.replace(/^refs\/(heads|tags)\//, "")}</span>
            <span className="text-xs">
              Ghost at <code className="font-mono">{short(ref.ghost)}</code> · GitHub at <code className="font-mono">{short(ref.github)}</code> · {ref.reason}
            </span>
          </li>
        ))}
      </ul>
    </Callout>
  );
}
