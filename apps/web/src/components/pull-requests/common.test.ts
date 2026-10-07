import { describe, expect, it } from "bun:test";

import { titleFromBranch } from "./common";

describe("titleFromBranch", () => {
  it("turns the branch's last segment into a sentence", () => {
    expect(titleFromBranch("alice:feat/add-rate_limiter")).toBe(
      "Add rate limiter",
    );
    expect(titleFromBranch("fix-login")).toBe("Fix login");
    expect(titleFromBranch("")).toBe("");
  });
});
