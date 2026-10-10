import { describe, expect, it } from "bun:test";

import { describeScope } from "./oauth-scopes";

describe("describeScope", () => {
  it("says what a scope allows", () => {
    expect(describeScope("repo")).toContain("private");
  });

  it("falls back for a scope Ghost does not know", () => {
    expect(describeScope("workflow")).toBe("Not used by Ghost");
  });
});
