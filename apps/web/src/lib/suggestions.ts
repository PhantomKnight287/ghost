import { apiClient, unwrap } from "@/lib/api/client";

type RepositoryRef = { username: string; repo: string };

/** People to mention or assign whose username starts with `q`, those involved in the repository first; with `q` empty, only the involved. */
export async function suggestUsers(
  { username, repo }: RepositoryRef,
  q: string,
) {
  const data = await unwrap(
    apiClient.GET("/api/repositories/{username}/{repo}/suggestions/users", {
      params: { path: { username, repo }, query: { q } },
    }),
  );
  return data.users;
}

/** Issues and pull requests whose number starts with `q` or whose title contains it, newest first. */
export async function suggestIssues(
  { username, repo }: RepositoryRef,
  q: string,
) {
  const data = await unwrap(
    apiClient.GET("/api/repositories/{username}/{repo}/suggestions/issues", {
      params: { path: { username, repo }, query: { q } },
    }),
  );
  return data.issues;
}

/** People whose username starts with `q` and teams whose slug contains it, of those a review on pull request `number` can be requested from. */
export async function suggestReviewers(
  { username, repo, number }: RepositoryRef & { number: number },
  q: string,
) {
  return unwrap(
    apiClient.GET(
      "/api/repositories/{username}/{repo}/pulls/{number}/requestable-reviewers",
      { params: { path: { username, repo, number }, query: { q } } },
    ),
  );
}
