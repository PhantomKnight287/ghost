/** The callback URLs typed one per line, blank lines left out. Shared by the form and its server actions. */
export const callbackUrlsOf = ({ callbackUrls }: { callbackUrls: string }) =>
  callbackUrls
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);
