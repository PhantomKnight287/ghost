/** Public origin of the course, used to absolutize metadata URLs. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_LEARN_URL ?? "http://localhost:3005";

/** Where `<Source>` links point: the repository the course describes, on its default branch. */
export const REPOSITORY_URL =
  process.env.NEXT_PUBLIC_REPOSITORY_URL ??
  "https://web.ghost.procrastinator.fyi/ghost/ghost";
