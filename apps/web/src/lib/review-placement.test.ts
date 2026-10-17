import { describe, expect, it } from "bun:test";

import { additionRanges, placeThreads } from "./review-placement";

const patch = `diff --git a/src/greet.js b/src/greet.js
--- a/src/greet.js
+++ b/src/greet.js
@@ -1,5 +1,13 @@
 export function greet(name) {
-  return "Hello, " + name;
+  if (!name) {
@@ -40 +48,2 @@ export function farewell(name) {
+  x
+  y
diff --git a/old.js b/renamed.js
similarity index 90%
--- a/old.js
+++ b/renamed.js
@@ -3,2 +3,3 @@
 a
+b
 c
diff --git a/gone.js b/gone.js
--- a/gone.js
+++ /dev/null
@@ -1,2 +0,0 @@
-a
-b
`;

describe("additionRanges", () => {
  it("reads each hunk's new-file range, defaulting a missing count to 1", () => {
    expect(additionRanges(patch).get("src/greet.js")).toEqual([
      [1, 13],
      [48, 49],
    ]);
  });

  it("keys a renamed file by its new path and skips a deleted one", () => {
    expect(additionRanges(patch).get("renamed.js")).toEqual([[3, 5]]);
    expect(additionRanges(patch).has("gone.js")).toBe(false);
  });
});

describe("additionRanges with names git quotes", () => {
  const quoted = [
    "diff --git a/my file.txt b/my file.txt",
    "--- a/my file.txt\t",
    "+++ b/my file.txt\t",
    "@@ -1 +1,2 @@",
    'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
    '--- "a/caf\\303\\251.txt"',
    '+++ "b/caf\\303\\251.txt"',
    "@@ -1 +1,2 @@",
    'diff --git "a/tab\\tx \\"q\\".txt" "b/tab\\tx \\"q\\".txt"',
    '--- "a/tab\\tx \\"q\\".txt"',
    '+++ "b/tab\\tx \\"q\\".txt"',
    "@@ -1 +1,2 @@",
  ].join("\n");

  it("drops the tab git appends to a name with a space", () => {
    expect(additionRanges(quoted).get("my file.txt")).toEqual([[1, 2]]);
  });

  it("decodes a quoted name's octal bytes as UTF-8", () => {
    expect(additionRanges(quoted).get("café.txt")).toEqual([[1, 2]]);
  });

  it("unescapes a quoted name's tab and quotes", () => {
    expect(additionRanges(quoted).get('tab\tx "q".txt')).toEqual([[1, 2]]);
  });
});

describe("placeThreads", () => {
  const at = (
    path: string,
    line: number,
    side: "additions" | "deletions" = "additions",
  ) => ({ path, line, side });

  it("places an additions thread whose line is inside a hunk", () => {
    const { placed, unplaced } = placeThreads(
      [at("src/greet.js", 9), at("src/greet.js", 20)],
      patch,
    );
    expect(placed).toEqual([at("src/greet.js", 9)]);
    expect(unplaced).toEqual([at("src/greet.js", 20)]);
  });

  it("never places a deletions-side thread or one on a file the commit does not touch", () => {
    const { placed } = placeThreads(
      [at("src/greet.js", 2, "deletions"), at("other.js", 1)],
      patch,
    );
    expect(placed).toEqual([]);
  });
});
