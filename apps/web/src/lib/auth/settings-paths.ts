/** Ghost's own settings tabs, which no better-auth-ui plugin knows about. A plain module, so the server route that validates paths reads the real array. */
export const GHOST_SETTINGS_PATHS = [
  "storage",
  "oauth-apps",
  "authorized-apps",
] as const;
