import { StaleAttemptError } from "./errors.ts";

const REQUEST_TIMEOUT_MS = 30_000;
// Backoff between tries of one callback: the API restarting must not cost the import, but a dead API must not hold it past its lease either.
const RETRY_DELAYS_MS = [1_000, 5_000, 20_000];

export type ImportedLabel = {
  name: string;
  color: string;
  description: string | null;
};

export type ImportedPullRequest = {
  state: "open" | "closed" | "merged";
  draft: boolean;
  baseRef: string;
  headRef: string;
  headSha: string;
  headInRepository: boolean;
  mergeCommitSha: string | null;
  mergedAt: string | null;
};

export type ImportedIssue = {
  number: number;
  title: string;
  body: string | null;
  authorLogin: string;
  state: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  labels: ImportedLabel[];
  pullRequest?: ImportedPullRequest;
};

export type ImportedRelease = {
  tagName: string;
  name: string | null;
  body: string | null;
  isDraft: boolean;
  isPrerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
};

export type ImportedComment = {
  githubId: number;
  issueNumber: number;
  authorLogin: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type Outcome =
  | { succeeded: true; defaultBranch: string }
  | { succeeded: false; error: string; retryable: boolean };

/** Postgres cannot store U+0000 in text, and GitHub text can carry it, such as a pasted error message about a binary file. */
function withoutNul(_key: string, value: unknown) {
  return typeof value === "string" ? value.replaceAll("\0", "\uFFFD") : value;
}

/** The API's callbacks for one attempt. Every call carries the attempt, and a 409 means the API moved on. */
export class GhostCallbacks {
  constructor(
    private readonly apiUrl: string,
    private readonly secret: string,
    private readonly importId: string,
    private readonly attempt: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = Bun.sleep,
  ) {}

  heartbeat() {
    return this.post("heartbeat", {});
  }

  releases(releases: ImportedRelease[]) {
    return this.post("releases", { releases });
  }

  issues(issues: ImportedIssue[]) {
    return this.post("issues", { issues });
  }

  comments(comments: ImportedComment[]) {
    return this.post("comments", { comments });
  }

  finish(outcome: Outcome) {
    return this.post("finish", outcome);
  }

  private async post(path: string, body: object) {
    const url = new URL(
      `/api/internal/imports/${this.importId}/${path}`,
      this.apiUrl,
    );
    const payload = JSON.stringify(
      { attempt: this.attempt, ...body },
      withoutNul,
    );

    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.secret}`,
        },
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).catch((error: unknown) => error as Error);

      if (response instanceof Response) {
        if (response.ok) return;
        if (response.status === 409) throw new StaleAttemptError();
        if (response.status < 500) {
          throw new Error(
            `The API refused ${path} with ${response.status}: ${await response.text()}`,
          );
        }
      }

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        const reason =
          response instanceof Response
            ? `status ${response.status}`
            : response.message;
        throw new Error(`The API did not take ${path}: ${reason}`);
      }
      await this.sleep(delay);
    }
  }
}
