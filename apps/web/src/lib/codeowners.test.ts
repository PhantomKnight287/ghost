import { describe, expect, it } from "bun:test";

import {
  CODEOWNERS_MAX_PATHS,
  CODEOWNERS_MAX_QUERY_LENGTH,
  codeownersBatches,
} from "./codeowners";

// openapi-fetch encodes each value with encodeURIComponent.
const queryLength = (paths: string[]) =>
  paths.map((path) => `path=${encodeURIComponent(path)}`).join("&").length;

describe("codeownersBatches", () => {
  it("keeps short paths together up to the path cap, in order", () => {
    const paths = Array.from({ length: 1001 }, (_, i) => `f${i}`);
    const batches = codeownersBatches(paths);
    expect(batches.map((batch) => batch.length)).toEqual([
      CODEOWNERS_MAX_PATHS,
      CODEOWNERS_MAX_PATHS,
      1,
    ]);
    expect(batches.flat()).toEqual(paths);
    expect(codeownersBatches([])).toEqual([]);
  });

  it("splits long paths into more, smaller batches under the query limit", () => {
    const paths = Array.from(
      { length: 500 },
      (_, i) => `src/components/some deep/folder/file-${i}.tsx`,
    );
    const batches = codeownersBatches(paths);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(paths);
    for (const batch of batches) {
      expect(queryLength(batch)).toBeLessThanOrEqual(
        CODEOWNERS_MAX_QUERY_LENGTH,
      );
    }
  });
});
