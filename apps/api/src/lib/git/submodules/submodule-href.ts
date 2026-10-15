import type { GithubOrigins } from '../../github/origins.js';

type Forge = 'github' | 'gitlab' | 'forgejo' | 'bitbucket' | 'sourcehut';

const TREE_PATHS: Record<Forge, (commit: string) => string> = {
  github: (commit) => `tree/${commit}`,
  gitlab: (commit) => `-/tree/${commit}`,
  forgejo: (commit) => `src/commit/${commit}`,
  bitbucket: (commit) => `src/${commit}`,
  sourcehut: (commit) => `tree/${commit}`,
};

const KNOWN_HOSTS: Record<string, Forge> = {
  'github.com': 'github',
  'gitee.com': 'github',
  'gitlab.com': 'gitlab',
  'framagit.org': 'gitlab',
  'salsa.debian.org': 'gitlab',
  'gitlab.gnome.org': 'gitlab',
  'gitlab.freedesktop.org': 'gitlab',
  'gitlab.archlinux.org': 'gitlab',
  'invent.kde.org': 'gitlab',
  'codeberg.org': 'forgejo',
  'git.gay': 'forgejo',
  'gitea.com': 'forgejo',
  'git.disroot.org': 'forgejo',
  'bitbucket.org': 'bitbucket',
  'git.sr.ht': 'sourcehut',
};

// "~" is sourcehut's owner prefix; "." and ".." alone are rejected below, so a path cannot climb out of the repository
const SEGMENT = /^[\w.~-]+$/;

/** `user@host:path`, git's scp-like syntax; `(?!\/)` keeps `https://` from reading as host `https`. */
const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/;

/** Where the web shows the repository at `url`: this instance's repository or a known host's tree at `commit`, or else the repository's page on its host. Null for a URL that names no host or no repository. */
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
    !segments.every(
      (segment) => SEGMENT.test(segment) && !/^\.\.?$/.test(segment),
    )
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

  const forge = KNOWN_HOSTS[remote.hostname];
  // GitLab nests groups, so only it takes a path deeper than owner and name
  if (
    forge &&
    (segments.length === 2 || (forge === 'gitlab' && segments.length > 2))
  ) {
    return `https://${remote.hostname}/${repository}/${TREE_PATHS[forge](commit)}`;
  }

  return `${remote.web}/${repository}`;
}

/** The remote's host and repository path, and the origin its web pages are guessed to live at: the URL's own for http(s), https on the bare host for SSH and git, whose ports serve no pages. */
function parseRemote(url: string, base: string) {
  const scp = SCP_LIKE.exec(url);
  if (scp) {
    const hostname = scp[1].toLowerCase();
    return { hostname, path: scp[2], web: `https://${hostname}` };
  }

  // git resolves only "./" and "../" against the superproject's remote; any other bare path is a directory on the cloning machine
  const relative = url.startsWith('./') || url.startsWith('../');
  const parsed = relative ? URL.parse(url, base) : URL.parse(url);
  if (!parsed || parsed.protocol === 'file:') return null;

  // origin, not href, so credentials written into the URL never reach the page
  const web = ['http:', 'https:'].includes(parsed.protocol)
    ? parsed.origin
    : `https://${parsed.hostname}`;
  return { hostname: parsed.hostname, path: parsed.pathname, web };
}
