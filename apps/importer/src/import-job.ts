import { mkdir, rm } from "node:fs/promises";
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
  // Names the import's working directory, so it must not be able to climb out of it.
  importId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  attempt: z.uuid(),
  source: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  destination: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/),
  githubToken: z.string().min(1),
  ghostToken: z.string().min(1),
  lastAttempt: z.boolean(),
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

  // One directory per import, not per attempt: a retry resumes from the clone the last attempt fetched instead of downloading the repository again. Kept only while a retry can still use it.
  const dir = path.join(config.IMPORTER_WORKDIR, job.importId);
  let keep = false;
  try {
    await mkdir(dir, { recursive: true });
    const started = performance.now();
    const defaultBranch = await importAll(job, config, ghost, dir, stop);
    await ghost.finish({ succeeded: true, defaultBranch });
    console.log(`import ${job.importId}: done in ${secondsSince(started)}s`);
  } catch (error) {
    const reason = stop.aborted ? stop.reason : error;
    if (reason instanceof StaleAttemptError) {
      // the attempt that superseded this one owns the directory now
      keep = true;
      console.log(`import ${job.importId}: attempt superseded, stopping`);
      return;
    }
    const message = reason instanceof Error ? reason.message : String(reason);
    const retryable = !(reason instanceof PermanentImportError);
    keep = retryable && !job.lastAttempt;
    console.error(`import ${job.importId}: ${message}`);
    await ghost
      .finish({ succeeded: false, error: message, retryable })
      .catch((finishError: unknown) =>
        console.error(
          `import ${job.importId}: could not report failure: ${String(finishError)}`,
        ),
      );
  } finally {
    clearInterval(heartbeat);
    if (!keep) await rm(dir, { recursive: true, force: true });
  }
}

async function importAll(
  job: Job,
  config: Config,
  ghost: GhostCallbacks,
  dir: string,
  attempt: AbortSignal,
) {
  const log = (message: string) =>
    console.log(`import ${job.importId}: ${message}`);
  // The history and the GitHub listings run side by side; whichever fails first stops the other.
  const sibling = new AbortController();
  const signal = AbortSignal.any([attempt, sibling.signal]);
  const failFast = <T>(work: Promise<T>) =>
    work.catch((error: unknown) => {
      sibling.abort(error);
      throw error;
    });

  const github = new GitHubClient(job.githubToken, signal);
  const repository = await github.get<GitHubRepository>(`/repos/${job.source}`);

  const [refs, pulls] = await Promise.all([
    failFast(copyHistory(job, config, dir, github, signal, log)),
    failFast(
      (async () => {
        await drain(
          log,
          "releases",
          github.pages<GitHubRelease>(`/repos/${job.source}/releases`),
          async (page) => {
            for (const chunk of chunkBySize(page.map(releaseFrom)))
              await ghost.releases(chunk);
          },
        );
        // Only the fields `pullRequestFrom` reads: GitHub's full payload carries both repositories and runs to tens of KB per pull request.
        const pulls = new Map<number, GitHubPull>();
        await drain(
          log,
          "pulls",
          github.pages<GitHubPull>(`/repos/${job.source}/pulls?state=all`),
          async (page) => {
            for (const pull of page) pulls.set(pull.number, slimPull(pull));
          },
        );
        return pulls;
      })(),
    ),
  ]);

  const started = performance.now();
  const mergeCommits = [...pulls.values()].flatMap((pull) =>
    pull.merge_commit_sha ? [pull.merge_commit_sha] : [],
  );
  const present = await presentCommits(dir, mergeCommits, signal);
  log(
    `merge commits: ${present.size}/${mergeCommits.length} present, ${secondsSince(started)}s`,
  );

  // After the push: a pull request written before its refs exist would be synced against a history that is not there yet.
  await drain(
    log,
    "issues",
    github.pages<GitHubIssue>(
      `/repos/${job.source}/issues?state=all&sort=created&direction=asc`,
    ),
    async (page) => {
      const issues = page.map((issue) =>
        issueFrom(issue, pulls.get(issue.number), {
          source: job.source,
          refs,
          present,
        }),
      );
      for (const chunk of chunkBySize(issues)) await ghost.issues(chunk);
    },
  );

  // Sent after every issue, since writing an issue clears the comments a previous attempt left on it.
  await drain(
    log,
    "comments",
    commentPages(github, job.source),
    async (page) => {
      const comments = page.map((comment) => ({
        githubId: comment.id,
        issueNumber: issueNumberOf(comment.issue_url),
        authorLogin: loginOf(comment.user),
        body: comment.body,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
      }));
      for (const chunk of chunkBySize(comments)) await ghost.comments(chunk);
    },
  );

  return repository.default_branch;
}

/** Clones from GitHub and pushes everything to Ghost in one push, returning the refs it carried. */
async function copyHistory(
  job: Job,
  config: Config,
  dir: string,
  github: GitHubClient,
  signal: AbortSignal,
  log: (message: string) => void,
) {
  let started = performance.now();
  await fetchFromGitHub({
    dir,
    source: job.source,
    token: job.githubToken,
    tokenWorked: github.authenticated,
    signal,
  });
  const refs = await listRefs(dir, signal);
  log(`fetch: ${refs.size} refs, ${secondsSince(started)}s`);

  started = performance.now();
  await pushToGhost({
    dir,
    apiUrl: config.GHOST_API_URL,
    destination: job.destination,
    token: job.ghostToken,
    signal,
  });
  log(`push: ${secondsSince(started)}s`);
  return refs;
}

/**
 * Every comment on the repository's issues and pull requests.
 *
 * GitHub ends this listing at page 300 without saying so, so it is read in windows ordered by update time, each starting where the last one reached. Windows overlap on that instant; the API drops the comments it already has.
 */
export async function* commentPages(
  github: Pick<GitHubClient, "pages">,
  source: string,
): AsyncGenerator<GitHubComment[]> {
  let since: string | undefined;
  for (;;) {
    let reached = since;
    const window = since ? `&since=${since}` : "";
    for await (const page of github.pages<GitHubComment>(
      `/repos/${source}/issues/comments?sort=updated&direction=asc${window}`,
    )) {
      if (page.length) reached = page.at(-1)!.updated_at;
      yield page;
    }
    if (reached === since) return;
    since = reached;
  }
}

export function slimPull(pull: GitHubPull): GitHubPull {
  return {
    number: pull.number,
    state: pull.state,
    draft: pull.draft,
    merged_at: pull.merged_at,
    merge_commit_sha: pull.merge_commit_sha,
    base: { ref: pull.base.ref },
    head: {
      ref: pull.head.ref,
      sha: pull.head.sha,
      repo: pull.head.repo && { full_name: pull.head.repo.full_name },
    },
  };
}

/** Feeds every page to `handle`, then logs the time spent waiting on GitHub apart from the time spent in `handle`, so a slow phase shows which side to fix. */
async function drain<T>(
  log: (message: string) => void,
  phase: string,
  pages: AsyncIterable<T[]>,
  handle: (page: T[]) => Promise<void>,
) {
  const started = performance.now();
  let handling = 0;
  let items = 0;
  let pageCount = 0;
  for await (const page of pages) {
    pageCount++;
    items += page.length;
    const handleStarted = performance.now();
    await handle(page);
    handling += performance.now() - handleStarted;
  }
  const total = performance.now() - started;
  log(
    `${phase}: ${items} items in ${pageCount} pages, ${seconds(total)}s (GitHub ${seconds(total - handling)}s, handling ${seconds(handling)}s)`,
  );
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);
const secondsSince = (started: number) => seconds(performance.now() - started);

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
