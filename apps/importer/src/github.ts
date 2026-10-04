import { PermanentImportError } from "./errors.ts";

const API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 30_000;
// The hourly quota resets within the hour, and a retried import starts over and spends it again, so waiting is cheaper. Anything longer is not the hourly quota.
const MAX_RATE_LIMIT_WAIT_MS = 65 * 60_000;

export type GitHubUser = { login: string } | null;

export type GitHubLabel = {
  name: string;
  color: string;
  description: string | null;
};

export type GitHubRepository = { default_branch: string };

export type GitHubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
};

export type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  user: GitHubUser;
  state: "open" | "closed";
  labels: GitHubLabel[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: unknown;
};

export type GitHubPull = {
  number: number;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  base: { ref: string };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
};

export type GitHubComment = {
  id: number;
  issue_url: string;
  user: GitHubUser;
  body: string;
  created_at: string;
  updated_at: string;
};

export type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

export const wait: Wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export class GitHubClient {
  /** Set by the first answer GitHub accepts. A 401 after that is the token expiring mid-attempt, which the next attempt's fresh token fixes; one before it is a token that was never good. */
  authenticated = false;

  constructor(
    private readonly token: string,
    private readonly signal: AbortSignal,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: Wait = wait,
  ) {}

  async get<T>(path: string): Promise<T> {
    const response = await this.request(new URL(path, API));
    return (await response.json()) as T;
  }

  /** Follows `Link: rel="next"` and yields one page at a time, so a repository with fifty thousand issues is never held in memory at once. The next page is requested before this one is handed over, so GitHub's latency overlaps the caller's work. */
  async *pages<T>(path: string): AsyncGenerator<T[]> {
    const first = new URL(path, API);
    first.searchParams.set("per_page", "100");
    let pending: Promise<Response> | null = this.request(first);
    while (pending) {
      const response: Response = await pending;
      const next = nextLink(response.headers.get("link"));
      pending = next && this.request(next);
      // A caller that stops early never awaits the page in flight; its failure must not surface as an unhandled rejection.
      pending?.catch(() => {});
      yield (await response.json()) as T[];
    }
  }

  private async request(url: URL): Promise<Response> {
    for (;;) {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.any([
          this.signal,
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ]),
      });
      if (response.ok) {
        this.authenticated = true;
        return response;
      }

      const delay = rateLimitDelay(response, Date.now());
      if (delay !== null) {
        if (delay > MAX_RATE_LIMIT_WAIT_MS) {
          throw new Error(
            `GitHub rate limit reached, it resets in ${Math.ceil(delay / 60_000)} minutes`,
          );
        }
        console.log(
          `GitHub rate limit on ${url.pathname}: waiting ${Math.ceil(delay / 1000)}s`,
        );
        await this.sleep(delay, this.signal);
        continue;
      }

      const detail = `GitHub answered ${response.status} for ${url.pathname}: ${await response.text()}`;
      if (response.status === 401 && this.authenticated) {
        throw new Error(
          `${detail} (the GitHub token expired during the import)`,
        );
      }
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
      ) {
        throw new PermanentImportError(detail);
      }
      throw new Error(detail);
    }
  }
}

/** How long GitHub asks to be left alone, or null when the response is not a rate limit. */
export function rateLimitDelay(response: Response, now: number): number | null {
  if (response.status !== 403 && response.status !== 429) return null;
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) return Number(retryAfter) * 1000;
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    return Math.max(reset - now, 0) + 1000;
  }
  return null;
}

export function nextLink(header: string | null): URL | null {
  const match = header?.match(/<([^>]+)>;\s*rel="next"/);
  return match ? new URL(match[1]!) : null;
}

/** Comments name their issue only by URL. */
export function issueNumberOf(issueUrl: string): number {
  return Number(issueUrl.slice(issueUrl.lastIndexOf("/") + 1));
}

/** GitHub shows a deleted account as `ghost`, and does the same here. */
export function loginOf(user: GitHubUser): string {
  return user?.login ?? "ghost";
}
