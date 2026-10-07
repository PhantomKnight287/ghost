/** Replace `value.slice(start, end)` with `insert`, then select `selectionStart`–`selectionEnd` of the result. */
export type Edit = {
  start: number;
  end: number;
  insert: string;
  selectionStart: number;
  selectionEnd: number;
};

export const FORMATS = [
  "heading",
  "bold",
  "italic",
  "quote",
  "code",
  "link",
  "bulleted",
  "numbered",
  "task",
] as const;
export type Format = (typeof FORMATS)[number];

const WRAPS: Partial<Record<Format, [string, string]>> = {
  bold: ["**", "**"],
  italic: ["_", "_"],
  code: ["`", "`"],
  link: ["[", "](url)"],
};

const LINE_PREFIXES: Partial<Record<Format, (index: number) => string>> = {
  heading: () => "### ",
  quote: () => "> ",
  bulleted: () => "- ",
  numbered: (index) => `${index + 1}. `,
  task: () => "- [ ] ",
};

/** The edit a toolbar button or shortcut makes to the selection. */
export function formatEdit(
  value: string,
  start: number,
  end: number,
  format: Format,
): Edit {
  const selected = value.slice(start, end);

  if (format === "code" && selected.includes("\n")) {
    const insert = `\`\`\`\n${selected}\n\`\`\``;
    return {
      start,
      end,
      insert,
      selectionStart: start + 4,
      selectionEnd: start + 4 + selected.length,
    };
  }

  const wrap = WRAPS[format];
  if (wrap) {
    const [before, after] = wrap;
    const insert = `${before}${selected}${after}`;
    // A link selects its placeholder URL, ready to be typed over; anything else keeps the text selected inside its markers.
    return format === "link"
      ? {
          start,
          end,
          insert,
          selectionStart: start + insert.length - 4,
          selectionEnd: start + insert.length - 1,
        }
      : {
          start,
          end,
          insert,
          selectionStart: start + before.length,
          selectionEnd: start + before.length + selected.length,
        };
  }

  const prefix = LINE_PREFIXES[format] as (index: number) => string;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf(
    "\n",
    end > start && value[end - 1] === "\n" ? end - 1 : end,
  );
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const insert = value
    .slice(lineStart, lineEnd)
    .split("\n")
    .map((line, index) => `${prefix(index)}${line}`)
    .join("\n");
  return start === end
    ? {
        start: lineStart,
        end: lineEnd,
        insert,
        selectionStart: lineStart + insert.length,
        selectionEnd: lineStart + insert.length,
      }
    : {
        start: lineStart,
        end: lineEnd,
        insert,
        selectionStart: lineStart,
        selectionEnd: lineStart + insert.length,
      };
}

/** `@` or `#` and what follows it, when the caret sits at the end of a mention or reference being typed. */
export type Mention = { trigger: "@" | "#"; query: string; start: number };

export function mentionAt(value: string, caret: number): Mention | null {
  const match = /(?:^|[\s([{])([@#])([\w-]*)$/.exec(value.slice(0, caret));
  if (!match) return null;
  return {
    trigger: match[1] as Mention["trigger"],
    query: match[2],
    start: caret - match[2].length - 1,
  };
}

/** Swaps the mention being typed for the chosen `@username` or `#number`, followed by a space unless one is already there. */
export function completeMention(
  value: string,
  mention: Mention,
  caret: number,
  completion: string,
): Edit {
  const spaced = /\s/.test(value[caret] ?? "");
  const insert = `${mention.trigger}${completion}${spaced ? "" : " "}`;
  const after = mention.start + insert.length + (spaced ? 1 : 0);
  return {
    start: mention.start,
    end: caret,
    insert,
    selectionStart: after,
    selectionEnd: after,
  };
}

const escapeLabel = (name: string) => name.replace(/[[\]\\]/g, "\\$&");

/** What stands in the text while a file uploads, so it can be found and replaced once it lands. */
export function uploadPlaceholder(name: string) {
  return `[Uploading ${escapeLabel(name)}…]()`;
}

/** Images embed; anything else links. */
export function attachmentMarkdown(
  name: string,
  url: string,
  contentType: string,
) {
  const link = `[${escapeLabel(name)}](${url})`;
  return contentType.startsWith("image/") ? `!${link}` : link;
}
