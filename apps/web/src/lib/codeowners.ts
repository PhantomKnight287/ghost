/** Where a CODEOWNERS file may live, in the API's lookup order: the first one present is the one in effect. */
export const CODEOWNERS_PATHS = [
  ".ghost/CODEOWNERS",
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
];

// The API takes at most 500 paths, below the 1,000 query keys Express keeps.
export const CODEOWNERS_MAX_PATHS = 500;
// Node refuses a request whose headers, request line included, pass 16 KiB, so the query stops well short of it.
export const CODEOWNERS_MAX_QUERY_LENGTH = 12_000;

/** `paths` in order, split into owner requests that fit both the API's path cap and Node's header limit. */
export function codeownersBatches(paths: string[]): string[][] {
  const batches: string[][] = [];
  let length = 0;
  for (const path of paths) {
    const added = `&path=${encodeURIComponent(path)}`.length;
    const last = batches.at(-1);
    if (
      !last ||
      last.length === CODEOWNERS_MAX_PATHS ||
      length + added > CODEOWNERS_MAX_QUERY_LENGTH
    ) {
      batches.push([path]);
      length = added;
    } else {
      last.push(path);
      length += added;
    }
  }
  return batches;
}
