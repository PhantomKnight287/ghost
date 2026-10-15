import type { components } from "@/lib/api/v1";
import { SITE_URL } from "@/lib/env";

type TreeEntry = components["schemas"]["TreeEntryDTO"];

/** A submodule's name and pinned commit, linked to the page the API gives for it. A page on another site opens in a new tab. */
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

  const external = !entry.submodule.href.startsWith(`${SITE_URL}/`);

  return (
    <a
      href={entry.submodule.href}
      title={title}
      {...(external && { target: "_blank", rel: "noopener noreferrer" })}
      className="min-w-0 truncate hover:text-primary hover:underline"
    >
      {label}
    </a>
  );
}
