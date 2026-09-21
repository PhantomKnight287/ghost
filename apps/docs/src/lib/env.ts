/** Public origin of the docs themselves, used to absolutize metadata URLs. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3003";

/** The Ghost instance these docs describe. Every "go to Settings" link points here, so a self-hosted instance sends readers to its own app rather than to someone else's. */
export const WEB_APP_URL =
  process.env.NEXT_PUBLIC_WEB_APP_URL ?? "http://localhost:3000";
