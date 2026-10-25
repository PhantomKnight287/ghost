/** Set by the proxy to the requested path and query, since layouts are not given them. */
export const PATH_HEADER = "x-ghost-path";

/** `path` with its leading segments replaced by `canonical`, keeping the rest of the path and the query. Without a path, just `canonical`. */
export function canonicalPath(path: string | null, canonical: string[]) {
  if (!path) return `/${canonical.join("/")}`;
  const url = new URL(path, "http://localhost");
  const rest = url.pathname.split("/").slice(canonical.length + 1);
  return `/${[...canonical, ...rest].join("/")}${url.search}`;
}
