import { describe, expect, it } from "bun:test";

import { assetProblem, releasePath } from "./common";

const storage = { usedBytes: 600, quotaBytes: 1000, maxAssetBytes: 300 };

describe("assetProblem", () => {
  it("passes files that fit, and anything when nothing is limited", () => {
    expect(
      assetProblem([{ name: "a.zip", size: 200 }], [], storage),
    ).toBeNull();
    expect(assetProblem([{ name: "a.zip", size: 1e12 }], [], null)).toBeNull();
    expect(
      assetProblem([{ name: "a.zip", size: 200 }], [], {
        ...storage,
        quotaBytes: null,
      }),
    ).toBeNull();
  });

  it("names a duplicate, whether attached already or picked twice", () => {
    expect(
      assetProblem([{ name: "a.zip", size: 1 }], [{ name: "a.zip" }], storage),
    ).toBe("a.zip is already attached.");
    expect(
      assetProblem(
        [
          { name: "a.zip", size: 1 },
          { name: "a.zip", size: 1 },
        ],
        [],
        storage,
      ),
    ).toBe("a.zip is already attached.");
  });

  it("names a file over the per-file limit", () => {
    expect(assetProblem([{ name: "big.iso", size: 301 }], [], storage)).toBe(
      "big.iso is over the 300 B limit for one file.",
    );
  });

  it("refuses files that together outgrow what is left of the quota", () => {
    expect(
      assetProblem(
        [
          { name: "a.zip", size: 250 },
          { name: "b.zip", size: 200 },
        ],
        [],
        storage,
      ),
    ).toBe("These files need 450 B, but only 400 B of storage is left.");
  });
});

describe("releasePath", () => {
  it("encodes each segment of a tag on its own", () => {
    expect(releasePath("o", "r", "release/v1+2", "download")).toBe(
      "/o/r/releases/download/release/v1%2B2",
    );
  });
});
