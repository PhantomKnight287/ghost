/** Splits the segments after `/tree/`, `/blob/`, `/raw/` or `/commits/` into a revision and a path: a branch may hold slashes, so the longest branch they start with wins, else the first segment (a tag or a sha). */
// ponytail: a tag with a slash in its name reads as its first segment only; resolve against the tag list too if one turns up.
export function splitRevision(segments: string[], branches: string[]) {
  const full = segments.join("/");
  const [branch] = branches
    .filter((name) => full === name || full.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length);
  const revision = branch ?? segments[0] ?? "";
  return { revision, path: full.slice(revision.length + 1) };
}

/** Link to a directory (`tree`) or file (`blob`) at a revision. The revision is one encoded segment, so a branch with slashes cannot read as part of the path. */
export function revisionHref(
  base: string,
  view: "tree" | "blob",
  revision: string,
  path: string,
) {
  return `${base}/${view}/${encodeURIComponent(revision)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
