export const GIT_SERVICES = ['git-upload-pack', 'git-receive-pack'] as const;

export type GitServiceName = (typeof GIT_SERVICES)[number];

export function isGitServiceName(value: unknown): value is GitServiceName {
  return GIT_SERVICES.includes(value as GitServiceName);
}

export function toGitBinary(service: GitServiceName) {
  return service.replace('git-', '') as 'upload-pack' | 'receive-pack';
}

/** The environment that lets git speak protocol v2, whose `ls-refs` sends only the refs a client asks for. Anything but an exact `version=2` keeps git on v0, so a client-supplied value never reaches git's environment. */
export function protocolEnv(requested: unknown): Record<string, string> {
  return requested === 'version=2' ? { GIT_PROTOCOL: 'version=2' } : {};
}
