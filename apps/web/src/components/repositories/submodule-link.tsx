import type { components } from "@/lib/api/v1";

type TreeEntry = components["schemas"]["TreeEntryDTO"];

/** A submodule's name and pinned commit, linked to where the commit can be browsed when the API knows a page for it. */
export function SubmoduleLink({
  entry,
}: {
  entry: Pick<TreeEntry, "name" | "oid" | "submodule">;
}) {
  const label = (
    <>
      {entry.name}{" "}
      <span className="text-muted-foreground">@ {entry.oid.slice(0, 7)}</span>
    </>
  );
  const title = entry.submodule?.url ?? "Submodule";

  if (!entry.submodule?.href) {
    return (
      <span title={title} className="min-w-0 truncate">
        {label}
      </span>
    );
  }

  return (
    <a
      href={entry.submodule.href}
      title={title}
      className="min-w-0 truncate hover:text-primary hover:underline"
    >
      {label}
    </a>
  );
}
