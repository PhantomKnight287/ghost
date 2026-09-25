/** Browser-facing API origin. Inlined into the bundle at build time. */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Origin the Next.js server itself calls. In Docker or on a private network the API is reachable under a name the browser cannot resolve; everywhere else this is the public origin. */
export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? API_URL;

/** Public origin of the web app, used to absolutize metadata URLs. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** Where the user guide is hosted; every "how do I" link points at it. */
export const DOCS_URL =
  process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3003";

/** `host:port` the SSH transport answers on. Empty when the instance runs without a host key, and the clone panel then offers HTTP alone. */
export const SSH_CLONE_HOST = process.env.NEXT_PUBLIC_SSH_CLONE_HOST ?? "";

/** `ssh://git@host:port/owner/repo.git`, or nothing when the instance runs no SSH listener. */
export function sshCloneUrlFor(username: string, repo: string) {
  if (!SSH_CLONE_HOST) return undefined;
  return `ssh://git@${SSH_CLONE_HOST}/${username}/${repo}.git`;
}
