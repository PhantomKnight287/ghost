import {
  type GitServiceName,
  isGitServiceName,
} from '../protocol/git-service.js';

export interface GitSshCommand {
  service: GitServiceName;
  username: string;
  repo: string;
}

/** `git-upload-pack '/octocat/hello.git'` - the two commands an SSH session may carry, and nothing else. Both the path and its quoting come from the client, so neither is trusted further than this regex. */
const GIT_COMMAND =
  /^(git-upload-pack|git-receive-pack) '?\/?([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?'?$/;

/** Returns null for anything that is not one of the two git services; the caller answers those without running a thing. */
export function parseGitCommand(command: string): GitSshCommand | null {
  const match = GIT_COMMAND.exec(command.trim());
  if (!match) return null;

  const [, service, username, repo] = match;
  if (!isGitServiceName(service)) return null;
  // A name may carry dots, but only as separators: `..` is the one that walks out of the namespace.
  if (username.includes('..') || repo.includes('..')) return null;

  return { service, username, repo };
}

export interface LfsAuthenticateCommand {
  username: string;
  repo: string;
  operation: 'download' | 'upload';
}

const LFS_AUTHENTICATE =
  /^git-lfs-authenticate '?\/?([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?'? (download|upload)$/;

/** `git-lfs-authenticate octocat/hello.git upload` - how git-lfs asks an SSH remote for HTTPS credentials. */
export function parseLfsAuthenticateCommand(
  command: string,
): LfsAuthenticateCommand | null {
  const match = LFS_AUTHENTICATE.exec(command.trim());
  if (!match) return null;

  const [, username, repo, operation] = match;
  if (username.includes('..') || repo.includes('..')) return null;
  return { username, repo, operation: operation as 'download' | 'upload' };
}
