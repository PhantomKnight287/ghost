import {
  type GitServiceName,
  isGitServiceName,
} from '../../../git/git.constants.js';

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
