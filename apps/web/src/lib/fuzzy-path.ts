/** Scores `query` as a subsequence of `text`: consecutive characters and characters that start a word score extra. `null` when `text` does not hold it. */
function subsequenceScore(text: string, query: string): number | null {
  let score = 0;
  let at = -1;
  for (const char of query) {
    const next = text.indexOf(char, at + 1);
    if (next === -1) return null;
    if (next === at + 1) score += 2;
    if (next === 0 || "/._- ".includes(text[next - 1])) score += 1;
    at = next;
  }
  return score;
}

/** Paths that fuzzy-match `query`, case-insensitively, best first: a match inside the file name outranks one that needs the directories, then tighter matches, then shorter paths. */
export function rankPaths(paths: string[], query: string, limit: number) {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (!needle) return paths.slice(0, limit);

  return paths
    .flatMap((path) => {
      const lower = path.toLowerCase();
      const inName = subsequenceScore(
        lower.slice(lower.lastIndexOf("/") + 1),
        needle,
      );
      const score =
        inName === null ? subsequenceScore(lower, needle) : 1000 + inName;
      return score === null ? [] : [{ path, score }];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.path.length - b.path.length ||
        a.path.localeCompare(b.path),
    )
    .slice(0, limit)
    .map(({ path }) => path);
}
