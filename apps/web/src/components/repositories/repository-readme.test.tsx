import { describe, expect, it } from "bun:test";

import { resolve } from "./repository-readme";

describe("resolve", () => {
  it("resolves against the directory the README sits in", () => {
    expect(resolve("logo.png", "packages/db")).toBe("packages/db/logo.png");
    expect(resolve("./logo.png", "packages/db")).toBe("packages/db/logo.png");
    expect(resolve("../logo.png", "packages/db")).toBe("packages/logo.png");
  });

  it("treats a leading slash as the repository root", () => {
    expect(resolve("/logo.png", "packages/db")).toBe("logo.png");
  });

  it("never escapes the repository", () => {
    expect(resolve("../../../etc/passwd", "packages/db")).toBe("etc/passwd");
  });

  it("leaves a root README's links alone", () => {
    expect(resolve("docs/guide.md")).toBe("docs/guide.md");
  });
});
