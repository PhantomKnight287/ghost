import { describe, expect, it } from "bun:test";

import type { IssueTimelineItem } from "@/types/issue";
import { commitRunAt } from "./common";

const event = (id: string, type: string, actorUsername = "ada") =>
  ({
    kind: "event",
    id,
    event: { id, type, actorUsername },
  }) as unknown as IssueTimelineItem;
const comment = (id: string) =>
  ({ kind: "comment", id }) as unknown as IssueTimelineItem;

const ids = (run: ReturnType<typeof commitRunAt>) =>
  run?.map((commit) => commit.id) ?? null;

describe("commitRunAt", () => {
  const items = [
    event("opened", "opened"),
    event("a", "committed"),
    event("b", "committed"),
    event("c", "committed", "grace"),
    comment("said"),
    event("d", "committed"),
  ];

  it("gathers one person's commits in a row into the block that starts them", () => {
    expect(ids(commitRunAt(items, 1))).toEqual(["a", "b"]);
    expect(ids(commitRunAt(items, 3))).toEqual(["c"]);
    expect(ids(commitRunAt(items, 5))).toEqual(["d"]);
  });

  it("leaves nothing to render for a commit that continues the block before it", () => {
    expect(commitRunAt(items, 2)).toBeNull();
  });
});
