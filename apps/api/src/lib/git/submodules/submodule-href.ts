import type { GithubOrigins } from '../../github/origins.js';

const KNOWN_HOSTS: Record<
  string,
  (repository: string, commit: string) => string
> = {
  'github.com': (repository, commit) =>
    `https://github.com/${repository}/tree/${commit}`,
  'gitlab.com': (repository, commit) =>
    `https://gitlab.com/${repository}/-/tree/${commit}`,
  'codeberg.org': (repository, commit) =>
    `https://codeberg.org/${repository}/src/commit/${commit}`,
};

const SEGMENT = /^[\w.-]+$/;

/** `user@host:path`, git's scp-like syntax; `(?!\/)` keeps `https://` from reading as host `https`. */
const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/;

/** Where the web shows the repository at `url` checked out at `commit`: this instance's repository page, or the tree page of a known host. Null for any other host or a URL that names no repository. */
export function submoduleHref({
  url,
  commit,
  owner,
  repo,
  origins,
}: {
  url: string;
  commit: string;
  /** The superproject, which a relative URL resolves against. */
  owner: string;
  repo: string;
  origins: GithubOrigins;
}): string | null {
  const remote = parseRemote(url, `${origins.api}/${owner}/${repo}.git/`);
  if (!remote?.hostname) return null;

  const segments = remote.path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '')
    .split('/');
  if (
    segments.length < 2 ||
    !segments.every((segment) => SEGMENT.test(segment))
  )
    return null;
  const repository = segments.join('/');

  const ghostHosts = [origins.api, origins.web, `ssh://${origins.sshHost}`].map(
    (origin) => URL.parse(origin)?.hostname,
  );
  if (ghostHosts.includes(remote.hostname)) {
    return segments.length === 2
      ? `${origins.web}/${repository}/tree/${commit}`
      : null;
  }

  // GitLab nests groups, so only it takes a path deeper than owner and name
  if (segments.length > 2 && remote.hostname !== 'gitlab.com') return null;
  return KNOWN_HOSTS[remote.hostname]?.(repository, commit) ?? null;
}

function parseRemote(url: string, base: string) {
  const scp = SCP_LIKE.exec(url);
  if (scp) return { hostname: scp[1].toLowerCase(), path: scp[2] };

  // git resolves only "./" and "../" against the superproject's remote; any other bare path is a directory on the cloning machine
  const relative = url.startsWith('./') || url.startsWith('../');
  const parsed = relative ? URL.parse(url, base) : URL.parse(url);
  if (!parsed || parsed.protocol === 'file:') return null;
  return { hostname: parsed.hostname, path: parsed.pathname };
}
