/** Where a CODEOWNERS file may live, in the API's lookup order: the first one present is the one in effect. */
export const CODEOWNERS_PATHS = [
  ".ghost/CODEOWNERS",
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
];
