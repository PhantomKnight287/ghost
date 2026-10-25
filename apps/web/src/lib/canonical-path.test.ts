import { describe, expect, it } from "bun:test";

import { canonicalPath } from "./canonical-path";

describe("canonicalPath", () => {
  it("swaps the owner and repository, keeping the rest and the query", () => {
    expect(
      canonicalPath("/PippinMole/Ghost/issues/3?tab=files", [
        "pippinmole",
        "ghost",
      ]),
    ).toBe("/pippinmole/ghost/issues/3?tab=files");
  });

  it("swaps a profile name", () => {
    expect(canonicalPath("/PippinMole?tab=stars", ["pippinmole"])).toBe(
      "/pippinmole?tab=stars",
    );
  });

  it("falls back to the canonical root without a path", () => {
    expect(canonicalPath(null, ["acme", "widget"])).toBe("/acme/widget");
  });
});
