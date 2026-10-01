import {
  GitHubNotConnectedError,
  GitHubRepositoryNotFoundError,
  GitHubUnavailableError,
} from './imports.errors.js';

const API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
// ponytail: stops at the 1,000 most recently pushed; an account past that needs server-side search over a cached list.
const MAX_PAGES = 10;

export type GitHubRepository = {
  fullName: string;
  private: boolean;
  description: string | null;
};

type RawRepository = {
  full_name: string;
  private: boolean;
  description: string | null;
};

/** Null for a 404. A 401 means the linked token was revoked, which only linking GitHub again fixes. */
async function githubGet<T>(token: string, path: string): Promise<T | null> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((cause: unknown) => {
    throw new GitHubUnavailableError({ cause });
  });

  if (response.status === 404) return null;
  if (response.status === 401) throw new GitHubNotConnectedError();
  if (!response.ok) {
    throw new GitHubUnavailableError({
      cause: new Error(
        `GitHub answered ${response.status}: ${await response.text()}`,
      ),
    });
  }
  return (await response.json()) as T;
}

/** Refuses before a repository is created for a source the token cannot read. GitHub answers 404 rather than 403 for a private repository the token cannot see. */
export async function assertGitHubRepositoryReadable(
  token: string,
  source: string,
) {
  const repository = await githubGet(token, `/repos/${source}`);
  if (!repository) throw new GitHubRepositoryNotFoundError(source);
}

/** Every repository the user owns, collaborates on, or reaches through an organization, most recently pushed first. Public repositories they merely can read are left out. */
export async function listGitHubRepositories(
  token: string,
): Promise<GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const raw =
      (await githubGet<RawRepository[]>(
        token,
        `/user/repos?sort=pushed&per_page=${PAGE_SIZE}&page=${page}&affiliation=owner,collaborator,organization_member`,
      )) ?? [];
    for (const repository of raw) {
      repositories.push({
        fullName: repository.full_name,
        private: repository.private,
        description: repository.description,
      });
    }
    if (raw.length < PAGE_SIZE) break;
  }
  return repositories;
}
