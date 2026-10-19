import { describe, expect, it } from "bun:test";

import type { IssueTimelineItem } from "@/types/issue";
import { reviewerRows, titleFromBranch } from "./common";

describe("titleFromBranch", () => {
  it("turns the branch's last segment into a sentence", () => {
    expect(titleFromBranch("alice:feat/add-rate_limiter")).toBe(
      "Add rate limiter",
    );
    expect(titleFromBranch("fix-login")).toBe("Fix login");
    expect(titleFromBranch("")).toBe("");
  });
});

describe("reviewerRows", () => {
  const review = (authorUsername: string, state: string | null) =>
    ({
      kind: "review",
      id: `${authorUsername}-${state}`,
      authorUsername,
      authorImage: null,
      state,
    }) as unknown as IssueTimelineItem;
  const comment = { kind: "comment", id: "c" } as unknown as IssueTimelineItem;
  const requested = (username: string, asCodeOwner = false) => ({
    id: username,
    username,
    name: null,
    image: null,
    asCodeOwner,
  });
  const states = (rows: ReturnType<typeof reviewerRows>) =>
    rows.map((row) => [row.username, row.state]);

  it("lists each person once: a pending request over a verdict, a verdict over a comment", () => {
    const rows = reviewerRows({
      requested: [requested("grace", true), requested("linus")],
      verdicts: [
        { username: "ada", image: null, state: "approved" },
        { username: "grace", image: null, state: "changes_requested" },
      ],
      timeline: [
        comment,
        review("ada", "commented"),
        review("ken", "commented"),
        review("grace", "changes_requested"),
      ],
      author: "dennis",
    });

    expect(states(rows)).toEqual([
      ["ada", "approved"],
      ["ken", "commented"],
      ["grace", "pending"],
      ["linus", "pending"],
    ]);
    expect(rows.find((row) => row.username === "grace")?.asCodeOwner).toBe(
      true,
    );
  });

  it("leaves out the author and reviews still pending", () => {
    const rows = reviewerRows({
      requested: [],
      verdicts: [],
      timeline: [review("dennis", "commented"), review("ada", null)],
      author: "dennis",
    });

    expect(rows).toEqual([]);
  });
});
