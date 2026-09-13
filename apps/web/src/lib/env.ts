/** Browser-facing API origin. Inlined into the bundle at build time. */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Origin the Next.js server itself calls. In Docker or on a private network the
 * API is reachable under a name the browser cannot resolve; everywhere else
 * this is the public origin.
 */
export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? API_URL;

/** Public origin of the web app, used to absolutize metadata URLs. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
