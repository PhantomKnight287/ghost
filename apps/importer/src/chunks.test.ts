import { expect, test } from "bun:test";

import { chunkBySize } from "./chunks.ts";

test("keeps order and splits once a chunk would pass the limit", () => {
  const [a, b, c] = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];
  expect(chunkBySize([a, b, c], 100)).toEqual([[a, b], [c]]);
});

test("sends an item larger than the limit on its own", () => {
  const big = "x".repeat(500);
  expect(chunkBySize(["a", big, "b"], 100)).toEqual([["a"], [big], ["b"]]);
});

test("returns nothing for nothing", () => {
  expect(chunkBySize([], 100)).toEqual([]);
});
