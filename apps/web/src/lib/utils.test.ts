import { describe, expect, it } from "bun:test";

import { formatBytes } from "./utils";

describe("formatBytes", () => {
  it("keeps bytes whole and gives larger units one decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });
});
