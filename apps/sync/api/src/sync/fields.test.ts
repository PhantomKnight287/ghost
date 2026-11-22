import { describe, expect, test } from "bun:test";
import { describeChanges, isNewer, mergeFields } from "./fields.ts";

describe("mergeFields", () => {
  const base = { title: "T", state: "open" };

  test("a field changed only on the source is written", () => {
    expect(mergeFields({ title: "T", state: "closed" }, base, base, false)).toEqual({ write: { state: "closed" }, agreed: { title: "T", state: "closed" } });
  });

  test("a field changed only on the target is left for the target's own pass", () => {
    expect(mergeFields(base, { title: "T", state: "closed" }, base, true)).toEqual({ write: {}, agreed: base });
  });

  test("a field changed on both sides goes to the newer one", () => {
    const source = { title: "Mine", state: "open" };
    const target = { title: "Theirs", state: "open" };
    expect(mergeFields(source, target, base, true).write).toEqual({ title: "Mine" });
    expect(mergeFields(source, target, base, false).write).toEqual({});
  });

  test("with no agreed state, the newer side wins", () => {
    expect(mergeFields({ state: "closed" }, { state: "open" }, null, true)).toEqual({ write: { state: "closed" }, agreed: { state: "closed" } });
    expect(mergeFields({ state: "closed" }, { state: "open" }, null, false)).toEqual({ write: {}, agreed: {} });
  });

  test("sides that already agree write nothing and record the agreement", () => {
    expect(mergeFields({ labels: ["a"] }, { labels: ["a"] }, null, false)).toEqual({ write: {}, agreed: { labels: ["a"] } });
  });
});

test("isNewer compares timestamps and treats a missing one as newer", () => {
  expect(isNewer({ updated_at: "2026-11-22T17:00:00Z" }, { updated_at: "2026-11-22T16:00:00.000+00:00" })).toBe(true);
  expect(isNewer({ updated_at: "2026-11-22T15:00:00Z" }, { updated_at: "2026-11-22T16:00:00Z" })).toBe(false);
  expect(isNewer({}, { updated_at: "2026-11-22T16:00:00Z" })).toBe(true);
});

test("describeChanges names each change", () => {
  expect(describeChanges({ state: "closed", title: "New", body: "b", labels: [], draft: false, base: "main" }, "GitHub pull request #3")).toEqual([
    "Closed GitHub pull request #3",
    'Retitled GitHub pull request #3 to "New"',
    "Edited the description of GitHub pull request #3",
    "Removed the labels of GitHub pull request #3",
    "Marked GitHub pull request #3 ready for review",
    "Changed the base branch of GitHub pull request #3 to main",
  ]);
  expect(describeChanges({ state: "open", labels: ["bug"], draft: true }, "Ghost issue #2")).toEqual(["Reopened Ghost issue #2", "Set the labels of Ghost issue #2 to bug", "Marked Ghost issue #2 as a draft"]);
  expect(describeChanges({ milestone: "v1" }, "Ghost issue #2")).toEqual(["Updated milestone of Ghost issue #2"]);
});
