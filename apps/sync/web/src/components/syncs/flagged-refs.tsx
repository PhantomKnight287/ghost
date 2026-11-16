import type { FlaggedRef } from "@/lib/api.ts";

const short = (sha: string | null) => sha?.slice(0, 7) ?? "deleted";

/** Branches and tags left alone because both sides changed, or a push was refused; they sync again once a person makes them agree. */
export function FlaggedRefs({ refs }: { refs: FlaggedRef[] }) {
  if (refs.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Needs a person</h2>
      <ul className="divide-y divide-neutral-200 rounded-lg border border-amber-300 dark:divide-neutral-800 dark:border-amber-800">
        {refs.map((ref) => (
          <li key={ref.name} className="flex flex-col gap-1 px-4 py-3 text-sm">
            <span className="font-mono">{ref.name.replace(/^refs\/(heads|tags)\//, "")}</span>
            <span className="text-neutral-500">
              Ghost at <code>{short(ref.ghost)}</code>, GitHub at <code>{short(ref.github)}</code> · {ref.reason}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
