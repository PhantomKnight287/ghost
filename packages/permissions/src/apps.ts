import slugify from "slugify";

/** Ghost App permissions under GitHub's names, with the levels each allows. `write` includes `read`; `metadata: read` is always granted. */
export const APP_PERMISSIONS = {
  metadata: ["read"],
  contents: ["read", "write"],
  pull_requests: ["read", "write"],
  issues: ["read", "write"],
  statuses: ["read", "write"],
  members: ["read"],
  administration: ["read", "write"],
} as const;

export type AppPermission = keyof typeof APP_PERMISSIONS;
export type AppPermissions = Partial<Record<AppPermission, "read" | "write">>;

/** An app's slug, made once from its name: accented letters transliterated, every other run of characters one hyphen. The bot is `slug[bot]`. Empty when the name has no letter or digit. */
export function appSlug(name: string) {
  return slugify(name, { lower: true, strict: true });
}
