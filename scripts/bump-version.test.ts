import { describe, expect, it } from "bun:test";

import { nextVersion } from "./bump-version";

describe("nextVersion", () => {
  it("bumps one part and resets the ones below it", () => {
    expect(nextVersion("1.4.2", "major")).toBe("2.0.0");
    expect(nextVersion("1.4.2", "minor")).toBe("1.5.0");
    expect(nextVersion("1.4.2", "patch")).toBe("1.4.3");
  });

  it("takes an explicit version as given", () => {
    expect(nextVersion("1.4.2", "3.0.0")).toBe("3.0.0");
  });

  it("rejects anything else", () => {
    expect(() => nextVersion("1.4.2", "")).toThrow();
    expect(() => nextVersion("1.4.2", "v2")).toThrow();
    expect(() => nextVersion("latest", "patch")).toThrow();
  });
});
