import { findReferences } from "@ghost/references";
import type { Nodes, PhrasingContent, Root, Text } from "mdast";

/** Links `#1`, `owner/repo#1`, `@user` and `@org/team` in prose. `#1` is resolved against `repository`; code and existing links are left alone. */
export function remarkReferences(repository: {
  username: string;
  repo: string;
}) {
  const linkify = ({ value }: Text): PhrasingContent[] => {
    const pieces: PhrasingContent[] = [];
    let cursor = 0;
    for (const reference of findReferences(value)) {
      const text = value.slice(
        reference.index,
        reference.index + reference.length,
      );
      const url =
        reference.kind === "issue"
          ? `/${reference.owner ?? repository.username}/${reference.repo ?? repository.repo}/issues/${reference.number}`
          : reference.kind === "team"
            ? `/${reference.organization}/teams/${reference.team}`
            : `/${reference.username}`;
      if (reference.index > cursor)
        pieces.push({
          type: "text",
          value: value.slice(cursor, reference.index),
        });
      pieces.push({
        type: "link",
        url,
        children: [{ type: "text", value: text }],
      });
      cursor = reference.index + reference.length;
    }
    if (cursor < value.length)
      pieces.push({ type: "text", value: value.slice(cursor) });
    return pieces;
  };

  const walk = (node: Nodes) => {
    if (
      !("children" in node) ||
      node.type === "link" ||
      node.type === "linkReference"
    )
      return;
    // Text only ever sits where phrasing content is allowed, so its replacements are valid children of the same parent.
    const children: Nodes[] = node.children;
    (node as { children: Nodes[] }).children = children.flatMap<Nodes>(
      (child) => {
        if (child.type === "text") return linkify(child);
        walk(child);
        return [child];
      },
    );
  };

  return (tree: Root) => walk(tree);
}
