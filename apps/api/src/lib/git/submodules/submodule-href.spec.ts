import { describe, expect, it } from 'vitest';

import { submoduleHref } from './submodule-href.js';

const COMMIT = 'a'.repeat(40);
const origins = {
  api: 'https://api.ghost.test',
  web: 'https://ghost.test',
  sshHost: 'ssh.ghost.test:2222',
};

const href = (url: string) =>
  submoduleHref({ url, commit: COMMIT, owner: 'ghost', repo: 'app', origins });

describe('submoduleHref', () => {
  it.each([
    ['https://api.ghost.test/ghost/lib.git', 'ghost/lib'],
    ['https://ghost.test/ghost/lib', 'ghost/lib'],
    ['ssh://git@ssh.ghost.test:2222/ghost/lib.git', 'ghost/lib'],
    ['git@ssh.ghost.test:ghost/lib.git', 'ghost/lib'],
    ['../lib.git', 'ghost/lib'],
    ['../../someone/lib', 'someone/lib'],
  ])('links %s to the repository on this instance', (url, repository) => {
    expect(href(url)).toBe(`https://ghost.test/${repository}/tree/${COMMIT}`);
  });

  it.each([
    [
      'https://github.com/octo/lib.git',
      `https://github.com/octo/lib/tree/${COMMIT}`,
    ],
    [
      'git@github.com:octo/lib.git',
      `https://github.com/octo/lib/tree/${COMMIT}`,
    ],
    [
      'https://GitHub.com/octo/lib/',
      `https://github.com/octo/lib/tree/${COMMIT}`,
    ],
    [
      'git://codeberg.org/octo/lib.git',
      `https://codeberg.org/octo/lib/src/commit/${COMMIT}`,
    ],
    [
      'https://gitlab.com/group/sub/lib.git',
      `https://gitlab.com/group/sub/lib/-/tree/${COMMIT}`,
    ],
  ])('links %s to its host', (url, expected) => {
    expect(href(url)).toBe(expected);
  });

  it.each([
    ['an unknown host', 'https://git.example.com/octo/lib.git'],
    ['a path on the cloning machine', '/srv/git/lib.git'],
    ['a bare relative directory', 'lib'],
    ['a file URL', 'file:///srv/git/lib.git'],
    ['a URL that is not one', 'https://'],
    ['a repository below the superproject', './lib'],
    ['an owner without a name', 'https://github.com/octo'],
    ['a nested path on GitHub', 'https://github.com/octo/lib/extra'],
    ['a nested path on this instance', 'https://ghost.test/ghost/lib/extra'],
    ['a name with characters no host allows', 'https://github.com/octo/l%20ib'],
  ])('gives no link for %s', (_, url) => {
    expect(href(url)).toBeNull();
  });

  it('reads no SSH host as this instance when it runs without SSH', () => {
    const url = 'git@ssh.ghost.test:ghost/lib.git';
    expect(
      submoduleHref({
        url,
        commit: COMMIT,
        owner: 'ghost',
        repo: 'app',
        origins: { ...origins, sshHost: '' },
      }),
    ).toBeNull();
  });
});
