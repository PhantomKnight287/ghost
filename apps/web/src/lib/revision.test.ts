import { describe, expect, it } from "bun:test";

import { splitRevision } from "./revision";

describe("splitRevision", () => {
  const branches = ["agent/dev-utilities", "agent", "main", "feat/a"];

  it("takes the longest branch the segments start with", () => {
    expect(splitRevision(["agent", "dev-utilities"], branches)).toEqual({
      revision: "agent/dev-utilities",
      path: "",
    });
    expect(
      splitRevision(["agent", "dev-utilities", "src", "a.ts"], branches),
    ).toEqual({ revision: "agent/dev-utilities", path: "src/a.ts" });
    expect(splitRevision(["agent", "src"], branches)).toEqual({
      revision: "agent",
      path: "src",
    });
  });

  it("reads a revision that already holds its slash, as an encoded link carries it", () => {
    expect(splitRevision(["feat/a", "README.md"], branches)).toEqual({
      revision: "feat/a",
      path: "README.md",
    });
  });

  it("falls back to the first segment for a tag or a sha", () => {
    expect(splitRevision(["v1.0.0", "src"], branches)).toEqual({
      revision: "v1.0.0",
      path: "src",
    });
    expect(splitRevision(["feat", "b"], branches)).toEqual({
      revision: "feat",
      path: "b",
    });
  });

  it("names nothing when there are no segments", () => {
    expect(splitRevision([], branches)).toEqual({ revision: "", path: "" });
  });
});
