import { describe, expect, it } from "bun:test";

import { CHANGELOG } from "./entries";

describe("changelog", () => {
  it("lists entries newest first, so the first one dates the page", () => {
    const dates = CHANGELOG.map(({ date }) => date);
    expect(dates).toEqual(dates.toSorted().reverse());
  });
});
