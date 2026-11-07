import { describe, expect, it } from "bun:test";

import type { components } from "@/lib/api/v1";

import { orderCheckRows } from "./checks";

type Run = components["schemas"]["CheckRunDTO"];
type Status = components["schemas"]["CommitStatusDTO"];

const run = (
  name: string,
  suiteId: string,
  status: Run["status"],
  conclusion: Run["conclusion"] = null,
) => ({ id: name, name, suiteId, status, conclusion }) as Run;
const status = (context: string, state: Status["state"]) =>
  ({ id: context, context, state }) as Status;

describe("orderCheckRows", () => {
  it("lists failing, then pending, then passing, runs and statuses together", () => {
    const rows = orderCheckRows({
      sha: "a",
      state: "failure",
      checkRuns: [
        run("build", "s1", "completed", "success"),
        run("lint", "s1", "in_progress"),
        run("test", "s1", "completed", "failure"),
      ],
      statuses: [status("vercel", "pending"), status("deploy", "error")],
    });
    expect(rows.map((row) => row.key)).toEqual([
      "test",
      "deploy",
      "lint",
      "vercel",
      "build",
    ]);
  });

  it("offers Re-run all on each app's first row only", () => {
    const rows = orderCheckRows({
      sha: "a",
      state: "failure",
      checkRuns: [
        run("a", "ci", "completed", "success"),
        run("b", "ci", "completed", "failure"),
        run("c", "sync", "completed", "skipped"),
      ],
      statuses: [],
    });
    expect(
      rows.flatMap((row) =>
        row.kind === "run" && row.rerunAll ? [row.key] : [],
      ),
    ).toEqual(["b", "c"]);
  });
});
