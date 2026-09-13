/** Link to the in-repository card route for a tree or blob path. */
export function ogUrl({
  username,
  repo,
  ref,
  path,
  kind = "tree",
}: {
  username: string;
  repo: string;
  ref: string;
  path: string;
  kind?: "tree" | "blob";
}) {
  const query = new URLSearchParams({ ref, path, kind });
  return `/${username}/${repo}/og?${query}`;
}
