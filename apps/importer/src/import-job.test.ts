import { describe, expect, spyOn, test } from "bun:test";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { GhostCallbacks } from "./ghost.ts";
import type { GitHubIssue, GitHubPull } from "./github.ts";
import { issueFrom, releaseFrom, runImport } from "./import-job.ts";

const issue: GitHubIssue = {
  number: 7,
  title: "Crash",
  body: "It crashes",
  user: { login: "octocat" },
  state: "closed",
  labels: [{ name: "bug", color: "D73A4A", description: "" }],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
  closed_at: "2024-01-02T00:00:00Z",
};

const pull: GitHubPull = {
  number: 7,
  state: "closed",
  draft: false,
  merged_at: "2024-01-02T00:00:00Z",
  merge_commit_sha: "a".repeat(40),
  base: { ref: "main" },
  head: { ref: "fix", sha: "b".repeat(40), repo: { full_name: "Octo/Repo" } },
};

const context = {
  source: "octo/repo",
  refs: new Set(["refs/heads/fix"]),
  present: new Set(["a".repeat(40)]),
};

describe("issueFrom", () => {
  test("maps an issue, lowercasing label colours", () => {
    expect(issueFrom(issue, undefined, context)).toEqual({
      number: 7,
      title: "Crash",
      body: "It crashes",
      authorLogin: "octocat",
      state: "closed",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      closedAt: "2024-01-02T00:00:00Z",
      labels: [{ name: "bug", color: "d73a4a", description: null }],
      pullRequest: undefined,
    });
  });

  test("a merged pull request keeps its merge commit when the history has it", () => {
    expect(issueFrom(issue, pull, context).pullRequest).toEqual({
      state: "merged",
      draft: false,
      baseRef: "main",
      headRef: "fix",
      headSha: "b".repeat(40),
      headInRepository: true,
      mergeCommitSha: "a".repeat(40),
      mergedAt: "2024-01-02T00:00:00Z",
    });
  });

  test("drops a merge commit the history lacks", () => {
    const result = issueFrom(issue, pull, { ...context, present: new Set() });
    expect(result.pullRequest?.mergeCommitSha).toBeNull();
  });

  test("a fork's branch, or a deleted one, is not in the repository", () => {
    const fork = {
      ...pull,
      merged_at: null,
      state: "open" as const,
      head: { ...pull.head, repo: { full_name: "someone/repo" } },
    };
    expect(issueFrom(issue, fork, context).pullRequest).toMatchObject({
      state: "open",
      headInRepository: false,
      mergeCommitSha: null,
    });
    const gone = { ...pull, head: { ...pull.head, repo: null } };
    expect(issueFrom(issue, gone, context).pullRequest?.headInRepository).toBe(
      false,
    );
    expect(
      issueFrom(issue, pull, { ...context, refs: new Set() }).pullRequest
        ?.headInRepository,
    ).toBe(false);
  });
});

test("releaseFrom turns empty names and bodies into null", () => {
  expect(
    releaseFrom({
      tag_name: "v1",
      name: "",
      body: "",
      draft: false,
      prerelease: true,
      created_at: "2024-01-01T00:00:00Z",
      published_at: null,
    }),
  ).toEqual({
    tagName: "v1",
    name: null,
    body: null,
    isDraft: false,
    isPrerelease: true,
    createdAt: "2024-01-01T00:00:00Z",
    publishedAt: null,
  });
});

for (const failure of ["mkdir", "mkdtemp"] as const) {
  test(`runImport reports ${failure} failures and clears its heartbeat`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "importer-setup-test-"));
    const workdir = path.join(root, "work");
    if (failure === "mkdir") await writeFile(workdir, "not a directory");
    const finish = spyOn(
      GhostCallbacks.prototype,
      "finish",
    ).mockResolvedValue();
    const clear = spyOn(globalThis, "clearInterval");
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      await runImport(
        {
          // A missing parent inside the prefix makes mkdtemp fail after mkdir succeeds.
          importId: failure === "mkdtemp" ? "missing/import" : "import_1",
          attempt: "attempt-1",
          source: "octo/repo",
          destination: "owner/repo",
          githubToken: "synthetic-github-token",
          ghostToken: "synthetic-ghost-token",
        },
        loadConfig({
          GHOST_API_URL: "http://localhost:3001",
          IMPORTER_SECRET: "synthetic-importer-secret",
          IMPORTER_WORKDIR: workdir,
        }),
      );
      expect(finish).toHaveBeenCalledTimes(1);
      expect(finish).toHaveBeenCalledWith({
        succeeded: false,
        error: expect.any(String),
        retryable: true,
      });
      expect(clear).toHaveBeenCalledTimes(1);
    } finally {
      finish.mockRestore();
      clear.mockRestore();
      log.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
}
