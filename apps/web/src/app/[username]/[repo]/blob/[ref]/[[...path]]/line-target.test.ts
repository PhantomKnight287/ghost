import { describe, expect, it } from "bun:test";

import { parseLineTarget } from "./line-target";

describe("parseLineTarget", () => {
  it("reads one line, a list and a range", () => {
    expect(parseLineTarget("#L10")).toEqual([[10, 10]]);
    expect(parseLineTarget("#L10,L11,L59")).toEqual([
      [10, 10],
      [11, 11],
      [59, 59],
    ]);
    expect(parseLineTarget("#L10-L59")).toEqual([[10, 59]]);
  });

  it("mixes lists and ranges, and orders a backwards range", () => {
    expect(parseLineTarget("#L59-L10,L3")).toEqual([
      [10, 59],
      [3, 3],
    ]);
  });

  it("rejects anything else", () => {
    for (const hash of [
      "",
      "#L",
      "#L10,",
      "#L10-",
      "#L1-L2-L3",
      "#x",
      "#L1}*{",
    ]) {
      expect(parseLineTarget(hash)).toBeNull();
    }
  });
});
