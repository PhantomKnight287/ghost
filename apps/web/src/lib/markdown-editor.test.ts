import { describe, expect, it } from "bun:test";

import {
  attachmentMarkdown,
  completeMention,
  type Edit,
  type Format,
  formatEdit,
  mentionAt,
  uploadPlaceholder,
} from "./markdown-editor";

/** The text after `edit`, with `|` marking the selection's ends. */
function apply(value: string, edit: Edit) {
  const text = value.slice(0, edit.start) + edit.insert + value.slice(edit.end);
  return `${text.slice(0, edit.selectionStart)}|${text.slice(edit.selectionStart, edit.selectionEnd)}|${text.slice(edit.selectionEnd)}`;
}

/** Formats the part of `marked` between the two `|`. */
function format(marked: string, as: Format) {
  const start = marked.indexOf("|");
  const end = marked.indexOf("|", start + 1) - 1;
  const value = marked.replaceAll("|", "");
  return apply(value, formatEdit(value, start, end, as));
}

describe("formatEdit", () => {
  it("wraps the selection, keeping it selected", () => {
    expect(format("a |word| b", "bold")).toBe("a **|word|** b");
    expect(format("a |word| b", "italic")).toBe("a _|word|_ b");
    expect(format("a |word| b", "code")).toBe("a `|word|` b");
  });

  it("leaves the caret between the markers when nothing is selected", () => {
    expect(format("a || b", "bold")).toBe("a **||** b");
  });

  it("selects a link's URL, ready to be typed over", () => {
    expect(format("see |docs|", "link")).toBe("see [docs](|url|)");
  });

  it("fences code that spans lines", () => {
    expect(format("|a\nb|", "code")).toBe("```\n|a\nb|\n```");
  });

  it("prefixes every line the selection touches", () => {
    expect(format("x\nfi|rst\nsec|ond\ny", "bulleted")).toBe(
      "x\n|- first\n- second|\ny",
    );
    expect(format("|one\ntwo|", "numbered")).toBe("|1. one\n2. two|");
    expect(format("|a|", "task")).toBe("|- [ ] a|");
    expect(format("|a|", "quote")).toBe("|> a|");
  });

  it("prefixes the caret's line and keeps typing at its end", () => {
    expect(format("one\ntw||o", "heading")).toBe("one\n### two||");
  });

  it("leaves the next line alone when the selection ends at a line break", () => {
    expect(format("|a\n|b", "quote")).toBe("|> a|\nb");
  });
});

describe("mentionAt", () => {
  it("finds the mention or reference ending at the caret", () => {
    expect(mentionAt("hi @oc", 6)).toEqual({
      trigger: "@",
      query: "oc",
      start: 3,
    });
    expect(mentionAt("fixes #1", 8)).toEqual({
      trigger: "#",
      query: "1",
      start: 6,
    });
    expect(mentionAt("@", 1)).toEqual({ trigger: "@", query: "", start: 0 });
    expect(mentionAt("(#4", 3)).toEqual({ trigger: "#", query: "4", start: 1 });
  });

  it("ignores triggers inside words and finished mentions", () => {
    expect(mentionAt("mail@example", 12)).toBeNull();
    expect(mentionAt("@octocat done", 13)).toBeNull();
    expect(mentionAt("# Heading", 9)).toBeNull();
  });
});

describe("completeMention", () => {
  it("replaces what was typed with the choice, spaced from what follows", () => {
    const value = "cc @oc thanks";
    const mention = mentionAt(value, 6);
    expect(mention).not.toBeNull();
    expect(apply(value, completeMention(value, mention!, 6, "octocat"))).toBe(
      "cc @octocat ||thanks",
    );
    expect(
      apply("@oc", completeMention("@oc", mentionAt("@oc", 3)!, 3, "octocat")),
    ).toBe("@octocat ||");
  });
});

describe("attachments", () => {
  it("embeds images and links anything else, escaping brackets in names", () => {
    expect(attachmentMarkdown("shot.png", "https://x/a", "image/png")).toBe(
      "![shot.png](https://x/a)",
    );
    expect(attachmentMarkdown("[1].log", "https://x/b", "text/plain")).toBe(
      "[\\[1\\].log](https://x/b)",
    );
    expect(uploadPlaceholder("a.zip")).toBe("[Uploading a.zip…]()");
  });
});
