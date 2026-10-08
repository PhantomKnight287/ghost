import { describe, expect, it } from "bun:test";

import { rankPaths } from "./fuzzy-path";

describe("rankPaths", () => {
  const paths = [
    "button/index.ts",
    "src/components/ui/button.tsx",
    "src/lib/utils.ts",
    "README.md",
  ];

  it("ranks a file-name match above a match in the directories", () => {
    expect(rankPaths(paths, "button", 10)).toEqual([
      "src/components/ui/button.tsx",
      "button/index.ts",
    ]);
  });

  it("matches a subsequence, ignoring case and spaces", () => {
    expect(rankPaths(paths, "rd me", 10)).toEqual(["README.md"]);
    expect(rankPaths(paths, "libutl", 10)).toEqual(["src/lib/utils.ts"]);
  });

  it("drops paths that do not hold the query", () => {
    expect(rankPaths(paths, "zzz", 10)).toEqual([]);
  });

  it("caps the result and lists everything for an empty query", () => {
    expect(rankPaths(paths, "", 2)).toEqual(paths.slice(0, 2));
  });
});
