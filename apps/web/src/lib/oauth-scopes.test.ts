import { describe, expect, it } from "bun:test";

import { describeScope } from "./oauth-scopes";

describe("describeScope", () => {
  it("says what a scope allows", () => {
    expect(describeScope("repo")).toMatchObject({ group: "repo" });
    expect(describeScope("repo").detail).toContain("private");
  });

  it("falls back for a scope Ghost does not know", () => {
    expect(describeScope("workflow")).toEqual({
      title: "workflow",
      detail: "Not used by Ghost.",
      group: "other",
    });
  });
});
