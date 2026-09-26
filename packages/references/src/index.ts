import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import {
  anyOf,
  buildRegExp,
  capture,
  charClass,
  choiceOf,
  digit,
  negativeLookahead,
  negativeLookbehind,
  oneOrMore,
  optional,
  whitespace,
  word,
  zeroOrMore,
} from "ts-regex-builder";

// Usernames and slugs may contain dots, but never end in one, so `@bob.` at the end of a sentence stays `bob`.
const name = (extra: string) => [
  word,
  optional([zeroOrMore(charClass(word, anyOf(extra))), word]),
];

// `abc#1`, `&#123;` and `a/#1` are not references; neither is `@1` glued to a word, like an email address.
const standalone = negativeLookbehind(charClass(word, anyOf("&/#@.")));
const end = negativeLookahead(charClass(word, anyOf("#@")));

// `issue.number` is a Postgres `integer`; a bigger number cannot name an issue and would fail the lookup.
const MAX_ISSUE_NUMBER = 2_147_483_647;

/** Each entry is one kind of reference. Add one here and `Reference` grows a matching variant; `read` returning null drops the match. */
const definitions = {
  issue: {
    pattern: buildRegExp(
      [
        standalone,
        optional([
          capture(
            choiceOf(
              "closes",
              "closed",
              "close",
              "fixes",
              "fixed",
              "fix",
              "resolves",
              "resolved",
              "resolve",
            ),
            { name: "keyword" },
          ),
          optional(":"),
          oneOrMore(whitespace),
        ]),
        capture(
          [
            optional([
              capture(name(".-"), { name: "owner" }),
              "/",
              capture(name(".-"), { name: "repo" }),
            ]),
            "#",
            capture(oneOrMore(digit), { name: "number" }),
          ],
          { name: "target" },
        ),
        end,
      ],
      { global: true, ignoreCase: true, hasIndices: true },
    ),
    read: (groups: Record<string, string | undefined>) => {
      const number = Number(groups.number);
      if (number < 1 || number > MAX_ISSUE_NUMBER) return null;
      return {
        owner: groups.owner ?? null,
        repo: groups.repo ?? null,
        number,
        closing: groups.keyword !== undefined,
      };
    },
  },
  mention: {
    pattern: buildRegExp(
      [
        standalone,
        capture(["@", capture(name(".-"), { name: "username" })], {
          name: "target",
        }),
        // `@org/team` is a team, not a mention of `org`.
        negativeLookahead(charClass(word, anyOf("#@/"))),
      ],
      { global: true, hasIndices: true },
    ),
    read: (groups: Record<string, string | undefined>) => ({
      username: groups.username ?? "",
    }),
  },
  team: {
    pattern: buildRegExp(
      [
        standalone,
        capture(
          [
            "@",
            capture(name(".-"), { name: "organization" }),
            "/",
            capture(name("-"), { name: "team" }),
          ],
          { name: "target" },
        ),
        end,
      ],
      { global: true, hasIndices: true },
    ),
    read: (groups: Record<string, string | undefined>) => ({
      organization: groups.organization ?? "",
      team: groups.team ?? "",
    }),
  },
};

type Definitions = typeof definitions;

export type Reference = {
  [Kind in keyof Definitions]: {
    kind: Kind;
    /** Offset of the linkable part (`#1`, not `closes #1`) in the text it was found in. */
    index: number;
    length: number;
  } & NonNullable<ReturnType<Definitions[Kind]["read"]>>;
}[keyof Definitions];

/** References in plain text, sorted by position. The text must already be free of code; `parseReferences` does that for markdown. */
export function findReferences(text: string): Reference[] {
  const found: Reference[] = [];
  for (const [kind, { pattern, read }] of Object.entries(definitions)) {
    for (const match of text.matchAll(pattern)) {
      const [index, stop] = match.indices?.groups?.target ?? [
        match.index,
        match.index + match[0].length,
      ];
      const fields = read(match.groups ?? {});
      if (fields) {
        found.push({
          kind,
          index,
          length: stop - index,
          ...fields,
        } as Reference);
      }
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** References in a markdown document, ignoring code and link text exactly as the renderer does. */
export function parseReferences(markdown: string): Reference[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const found: Reference[] = [];
  const walk = (node: Nodes) => {
    if (node.type === "text") found.push(...findReferences(node.value));
    else if (
      "children" in node &&
      node.type !== "link" &&
      node.type !== "linkReference"
    ) {
      for (const child of node.children) walk(child);
    }
  };
  walk(tree);
  return found;
}
