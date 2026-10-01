import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { chunkBySize } from "./chunks.ts";
import type { Config } from "./config.ts";
import { PermanentImportError, StaleAttemptError } from "./errors.ts";
import {
  fetchFromGitHub,
  listRefs,
  presentCommits,
  pushToGhost,
} from "./git.ts";
import {
  GhostCallbacks,
  type ImportedIssue,
  type ImportedPullRequest,
} from "./ghost.ts";
import {
  GitHubClient,
  type GitHubComment,
  type GitHubIssue,
  type GitHubPull,
  type GitHubRelease,
  type GitHubRepository,
  issueNumberOf,
  loginOf,
} from "./github.ts";

const HEARTBEAT_MS = 30_000;

export const jobSchema = z.object({
  importId: z.string().min(1),
  attempt: z.uuid(),
  source: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  destination: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/),
  githubToken: z.string().min(1),
  ghostToken: z.string().min(1),
});

export type Job = z.infer<typeof jobSchema>;

/** Runs one attempt to the end and reports how it went. Never throws: whatever goes wrong becomes the outcome the API decides to retry or not. */
export async function runImport(job: Job, config: Config) {
  const ghost = new GhostCallbacks(
    config.GHOST_API_URL,
    config.IMPORTER_SECRET,
    job.importId,
    job.attempt,
  );
  const attempt = new AbortController();
  const stop = attempt.signal;

  const heartbeat = setInterval(() => {
    ghost.heartbeat().catch((error: unknown) => {
      if (error instanceof StaleAttemptError) attempt.abort(error);
    });
  }, HEARTBEAT_MS);

  await mkdir(config.IMPORTER_WORKDIR, { recursive: true });
  const dir = await mkdtemp(
    path.join(config.IMPORTER_WORKDIR, `${job.importId}-`),
  );
  try {
    const defaultBranch = await importAll(job, config, ghost, dir, stop);
    await ghost.finish({ succeeded: true, defaultBranch });
    console.log(`import ${job.importId}: done`);
  } catch (error) {
    const reason = stop.aborted ? stop.reason : error;
    if (reason instanceof StaleAttemptError) {
      console.log(`import ${job.importId}: attempt superseded, stopping`);
      return;
    }
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error(`import ${job.importId}: ${message}`);
    await ghost
      .finish({
        succeeded: false,
        error: message,
        retryable: !(reason instanceof PermanentImportError),
      })
      .catch((finishError: unknown) =>
        console.error(
          `import ${job.importId}: could not report failure: ${String(finishError)}`,
        ),
      );
  } finally {
    clearInterval(heartbeat);
    await rm(dir, { recursive: true, force: true });
  }
}

async function importAll(
  job: Job,
  config: Config,
  ghost: GhostCallbacks,
  dir: string,
  signal: AbortSignal,
) {
  const github = new GitHubClient(job.githubToken, signal);
  const repository = await github.get<GitHubRepository>(`/repos/${job.source}`);

  await fetchFromGitHub({
    dir,
    source: job.source,
    token: job.githubToken,
    signal,
  });
  const refs = await listRefs(dir, signal);
  await pushToGhost({
    dir,
    apiUrl: config.GHOST_API_URL,
    destination: job.destination,
    token: job.ghostToken,
    refs,
    signal,
  });

  for await (const page of github.pages<GitHubRelease>(
    `/repos/${job.source}/releases`,
  )) {
    for (const chunk of chunkBySize(page.map(releaseFrom)))
      await ghost.releases(chunk);
  }

  const pulls = new Map<number, GitHubPull>();
  for await (const page of github.pages<GitHubPull>(
    `/repos/${job.source}/pulls?state=all`,
  )) {
    for (const pull of page) pulls.set(pull.number, pull);
  }
  const mergeCommits = [...pulls.values()].flatMap((pull) =>
    pull.merge_commit_sha ? [pull.merge_commit_sha] : [],
  );
  const present = await presentCommits(dir, mergeCommits, signal);

  for await (const page of github.pages<GitHubIssue>(
    `/repos/${job.source}/issues?state=all&sort=created&direction=asc`,
  )) {
    const issues = page.map((issue) =>
      issueFrom(issue, pulls.get(issue.number), {
        source: job.source,
        refs,
        present,
      }),
    );
    for (const chunk of chunkBySize(issues)) await ghost.issues(chunk);
  }

  // Sent after every issue, since writing an issue clears the comments a previous attempt left on it.
  for await (const page of github.pages<GitHubComment>(
    `/repos/${job.source}/issues/comments?sort=created&direction=asc`,
  )) {
    const comments = page.map((comment) => ({
      issueNumber: issueNumberOf(comment.issue_url),
      authorLogin: loginOf(comment.user),
      body: comment.body,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
    }));
    for (const chunk of chunkBySize(comments)) await ghost.comments(chunk);
  }

  return repository.default_branch;
}

export function releaseFrom(release: GitHubRelease) {
  return {
    tagName: release.tag_name,
    name: release.name || null,
    body: release.body || null,
    isDraft: release.draft,
    isPrerelease: release.prerelease,
    createdAt: release.created_at,
    publishedAt: release.published_at,
  };
}

export function issueFrom(
  issue: GitHubIssue,
  pull: GitHubPull | undefined,
  context: { source: string; refs: Set<string>; present: Set<string> },
): ImportedIssue {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    authorLogin: loginOf(issue.user),
    state: issue.state,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    labels: issue.labels.map((label) => ({
      name: label.name,
      color: label.color.toLowerCase(),
      description: label.description || null,
    })),
    pullRequest: pull && pullRequestFrom(pull, context),
  };
}

function pullRequestFrom(
  pull: GitHubPull,
  {
    source,
    refs,
    present,
  }: { source: string; refs: Set<string>; present: Set<string> },
): ImportedPullRequest {
  const sameRepository =
    pull.head.repo?.full_name.toLowerCase() === source.toLowerCase();
  const mergeCommitSha =
    pull.merged_at &&
    pull.merge_commit_sha &&
    present.has(pull.merge_commit_sha)
      ? pull.merge_commit_sha
      : null;
  return {
    state: pull.merged_at ? "merged" : pull.state,
    draft: pull.draft,
    baseRef: pull.base.ref,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    headInRepository: sameRepository && refs.has(`refs/heads/${pull.head.ref}`),
    mergeCommitSha,
    mergedAt: pull.merged_at,
  };
}
