import { describe, expect, spyOn, test } from "bun:test";

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { PermanentImportError } from "./errors.ts";
import { GhostCallbacks } from "./ghost.ts";
import {
  type GitHubComment,
  GitHubClient,
  type GitHubIssue,
  type GitHubPull,
} from "./github.ts";
import {
  commentPages,
  issueFrom,
  type Job,
  releaseFrom,
  runImport,
} from "./import-job.ts";

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

test("commentPages reads past GitHub's page cap in windows", async () => {
  // Six comments, two sharing an update time across a window's edge, behind a listing that stops after two pages of two.
  const times = ["01", "02", "03", "03", "04", "05"];
  const all = times.map(
    (minute, index) =>
      ({
        id: index + 1,
        updated_at: `2024-01-01T00:${minute}:00Z`,
      }) as GitHubComment,
  );
  const paths: string[] = [];
  const github = {
    async *pages<T>(path: string) {
      paths.push(path);
      const since = new URL(path, "https://x").searchParams.get("since");
      const rest = all.filter((c) => !since || c.updated_at >= since);
      for (let page = 0; page < 2 && page * 2 < rest.length; page++)
        yield rest.slice(page * 2, page * 2 + 2) as T[];
    },
  };

  const seen = new Set<number>();
  for await (const page of commentPages(github, "o/r"))
    for (const comment of page) seen.add(comment.id);

  expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  expect(paths[0]).toBe(
    "/repos/o/r/issues/comments?sort=updated&direction=asc",
  );
  expect(paths.at(-1)).toContain("since=2024-01-01T00:05:00Z");
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

const attemptJob = (overrides: Partial<Job> = {}): Job => ({
  importId: "import_1",
  attempt: "attempt-1",
  source: "octo/repo",
  destination: "owner/repo",
  githubToken: "synthetic-github-token",
  ghostToken: "synthetic-ghost-token",
  lastAttempt: false,
  ...overrides,
});

const workConfig = (workdir: string) =>
  loadConfig({
    GHOST_API_URL: "http://localhost:3001",
    IMPORTER_SECRET: "synthetic-importer-secret",
    IMPORTER_WORKDIR: workdir,
  });

test("runImport reports a workdir it cannot create and clears its heartbeat", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "importer-setup-test-"));
  const workdir = path.join(root, "work");
  await writeFile(workdir, "not a directory");
  const finish = spyOn(GhostCallbacks.prototype, "finish").mockResolvedValue();
  const clear = spyOn(globalThis, "clearInterval");
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    await runImport(attemptJob(), workConfig(workdir));
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

describe("the import's working directory", () => {
  const cases = [
    { name: "survives a failure a retry will follow", keep: true },
    {
      name: "goes after the last attempt",
      keep: false,
      job: { lastAttempt: true },
    },
    {
      name: "goes after a failure no retry can fix",
      keep: false,
      error: new PermanentImportError("Repository not found"),
    },
  ];
  for (const { name, keep, job, error } of cases) {
    test(name, async () => {
      const workdir = await mkdtemp(path.join(os.tmpdir(), "importer-dir-"));
      // what an earlier attempt fetched
      const clone = path.join(workdir, "import_1");
      await mkdir(clone);
      await writeFile(path.join(clone, "HEAD"), "ref: refs/heads/main\n");
      const get = spyOn(GitHubClient.prototype, "get").mockRejectedValue(
        error ?? new Error("GitHub answered 502"),
      );
      const finish = spyOn(
        GhostCallbacks.prototype,
        "finish",
      ).mockResolvedValue();
      const log = spyOn(console, "error").mockImplementation(() => {});
      try {
        await runImport(attemptJob(job), workConfig(workdir));
        expect(existsSync(path.join(clone, "HEAD"))).toBe(keep);
      } finally {
        get.mockRestore();
        finish.mockRestore();
        log.mockRestore();
        await rm(workdir, { recursive: true, force: true });
      }
    });
  }
});
