import type { Nodes, PhrasingContent, Root, Text } from "mdast";

export const ALERTS = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
} as const;

export type AlertType = keyof typeof ALERTS;

const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(\r?\n|\r)?/i;

/** GitHub's alerts: a top-level blockquote whose first line is only `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`. One with nothing after the marker stays a blockquote, as on GitHub. */
export function remarkAlerts() {
  return (tree: Root) => {
    for (const node of tree.children) {
      if (node.type !== "blockquote") continue;
      const [first] = node.children;
      if (first?.type !== "paragraph") continue;
      const [text] = first.children;
      if (text?.type !== "text") continue;
      const match = MARKER.exec(text.value);
      if (!match) continue;

      const rest = text.value.slice(match[0].length);
      // the marker must end its line: `[!NOTE] **x**` is a quote that happens to start with brackets
      if (!match[2] && (rest || first.children.length > 1)) continue;
      const emptied = !rest && first.children.length === 1;
      if (emptied && node.children.length === 1) continue;

      if (rest) text.value = rest;
      else first.children.shift();
      if (emptied) node.children.shift();

      const type = match[1]!.toLowerCase() as AlertType;
      node.data = {
        hName: "div",
        hProperties: {
          className: ["markdown-alert", `markdown-alert-${type}`],
        },
      };
      node.children.unshift({
        type: "paragraph",
        data: { hProperties: { className: ["markdown-alert-title"] } },
        children: [{ type: "text", value: ALERTS[type] }],
      });
    }
  };
}

/** GitHub's comment rendering: every newline in issue, pull request and comment text is a line break, which a Markdown file does not do. */
export function remarkBreaks() {
  const walk = (node: Nodes) => {
    if (!("children" in node)) return;
    node.children = (node.children as Nodes[]).flatMap((child): Nodes[] => {
      if (child.type === "text") return split(child);
      walk(child);
      return [child];
    }) as typeof node.children;
  };
  return (tree: Root) => walk(tree);
}

function split({ value }: Text): PhrasingContent[] {
  return value
    .split(/\r?\n|\r/)
    .flatMap((line, index): PhrasingContent[] => [
      ...(index > 0 ? [{ type: "break" } as const] : []),
      ...(line ? [{ type: "text", value: line } as const] : []),
    ]);
}
