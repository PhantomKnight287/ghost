/** The GitHub OAuth scopes Ghost recognizes. gh checks `repo` and `read:org` on login; the rest are granted so tools that ask for them keep working. */
export const KNOWN_SCOPES = [
  'repo',
  'public_repo',
  'read:org',
  'write:org',
  'admin:org',
  'user',
  'read:user',
  'user:email',
  'admin:public_key',
  'write:public_key',
  'read:public_key',
  'delete_repo',
  'gist',
] as const;

export type Scope = (typeof KNOWN_SCOPES)[number];

/** Stands for "no scope" in the oauth-provider plugin, which reads an empty request as every scope where GitHub reads it as public access only. `grantableScopes` drops it. */
export const NO_SCOPE = 'public';

/** What each scope also grants, as on GitHub. */
const IMPLIES: Partial<Record<Scope, readonly Scope[]>> = {
  repo: ['public_repo'],
  'admin:org': ['write:org', 'read:org'],
  'write:org': ['read:org'],
  'admin:public_key': ['write:public_key', 'read:public_key'],
  'write:public_key': ['read:public_key'],
  user: ['read:user', 'user:email'],
};

export function hasScope(granted: readonly string[], needed: Scope) {
  return granted.some((scope) => scope === needed || IMPLIES[scope as Scope]?.includes(needed));
}

/** The known scopes in a space-separated OAuth `scope` request, in order; unknown ones are dropped, so gh asking for one Ghost lacks still logs in. */
export function grantableScopes(requested: string) {
  return requested.split(/\s+/).filter((scope): scope is Scope => (KNOWN_SCOPES as readonly string[]).includes(scope));
}

/** A key's granted scopes. Keys made in Ghost carry none and hold every scope, as Ghost keys always have. */
export function scopesOfKey(permissions: Record<string, string[]> | null | undefined): readonly string[] {
  return permissions?.scopes ?? KNOWN_SCOPES;
}
