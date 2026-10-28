import { describe, expect, test } from "bun:test";

import { appSlug } from "./apps";

describe("appSlug", () => {
  test("lowercases a name and joins its words with hyphens", () => {
    expect(appSlug("My CI Bot")).toBe("my-ci-bot");
  });

  test("collapses every run of other characters into one hyphen and trims the ends", () => {
    expect(appSlug("  Lint!!  bot  ")).toBe("lint-bot");
  });

  test("transliterates accented letters, as team slugs do", () => {
    expect(appSlug("Ünïcode")).toBe("unicode");
  });

  test("leaves nothing of a name without letters or digits", () => {
    expect(appSlug("!!!")).toBe("");
  });
});
