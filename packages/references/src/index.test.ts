import { describe, expect, test } from "bun:test";

import { findReferences, parseReferences } from "./index";

describe("findReferences", () => {
  test("finds a same-repository reference", () => {
    expect(findReferences("see #12")).toEqual([
      {
        kind: "issue",
        index: 4,
        length: 3,
        owner: null,
        repo: null,
        number: 12,
        closing: false,
      },
    ]);
  });

  test("finds a cross-repository reference", () => {
    expect(findReferences("ghost/web.app#3")).toEqual([
      {
        kind: "issue",
        index: 0,
        length: 15,
        owner: "ghost",
        repo: "web.app",
        number: 3,
        closing: false,
      },
    ]);
  });

  test("marks closing keywords, in any case, with or without a colon, and points at the reference only", () => {
    const [closes, fixed, resolve] = findReferences(
      "Closes #1, fixed: #2 and RESOLVE a/b#3",
    );
    expect(closes).toMatchObject({
      index: 7,
      length: 2,
      number: 1,
      closing: true,
    });
    expect(fixed).toMatchObject({ number: 2, closing: true });
    expect(resolve).toMatchObject({
      owner: "a",
      repo: "b",
      number: 3,
      closing: true,
    });
  });

  test("a keyword glued to a word does not close", () => {
    expect(findReferences("prefixes #1")).toMatchObject([
      { number: 1, closing: false },
    ]);
  });

  test("ignores numbers that are not standalone", () => {
    expect(findReferences("abc#1 &#123; a/#1 #1a #1#2 http://x.io/#4")).toEqual(
      [],
    );
  });

  test("finds a team mention without mentioning its organization", () => {
    expect(findReferences("ping @acme/core-team and @bob")).toEqual([
      {
        kind: "team",
        index: 5,
        length: 15,
        organization: "acme",
        team: "core-team",
      },
      { kind: "mention", index: 25, length: 4, username: "bob" },
    ]);
  });

  test("finds mentions but not email addresses, and drops a trailing dot", () => {
    expect(findReferences("thanks @bob.smith. mail a@b.com @jane-doe")).toEqual(
      [
        { kind: "mention", index: 7, length: 10, username: "bob.smith" },
        { kind: "mention", index: 32, length: 9, username: "jane-doe" },
      ],
    );
  });

  test("drops numbers no issue can have", () => {
    expect(findReferences("`#99999999999`")).toEqual([]);
    expect(findReferences("#2147483648 #0")).toEqual([]);
    expect(findReferences("#2147483647")).toMatchObject([
      { number: 2147483647 },
    ]);
  });

  test("sorts mixed kinds by position", () => {
    expect(
      findReferences("@a fixes #1").map((reference) => reference.kind),
    ).toEqual(["mention", "issue"]);
  });
});

describe("parseReferences", () => {
  test("skips code blocks, inline code and links", () => {
    const markdown = [
      "fixes #1 `#2`",
      "```",
      "#3",
      "```",
      "    #4",
      "[#5](https://x.io) https://x.io/a#6 <b>#7</b>",
    ].join("\n");
    expect(
      parseReferences(markdown).map(
        (reference) => reference.kind === "issue" && reference.number,
      ),
    ).toEqual([1, 7]);
  });
});
