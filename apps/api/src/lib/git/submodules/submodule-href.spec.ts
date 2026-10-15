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
    [
      'https://salsa.debian.org/debian/lib.git',
      `https://salsa.debian.org/debian/lib/-/tree/${COMMIT}`,
    ],
    [
      'https://git.gay/octo/lib.git',
      `https://git.gay/octo/lib/src/commit/${COMMIT}`,
    ],
    [
      'git@bitbucket.org:octo/lib.git',
      `https://bitbucket.org/octo/lib/src/${COMMIT}`,
    ],
    [
      'https://git.sr.ht/~octo/lib',
      `https://git.sr.ht/~octo/lib/tree/${COMMIT}`,
    ],
    [
      'https://gitee.com/octo/lib.git',
      `https://gitee.com/octo/lib/tree/${COMMIT}`,
    ],
  ])('links %s to its host at the commit', (url, expected) => {
    expect(href(url)).toBe(expected);
  });

  it.each([
    [
      'https://git.example.com/octo/lib.git',
      'https://git.example.com/octo/lib',
    ],
    ['http://git.example.com:8080/lib.git', 'http://git.example.com:8080/lib'],
    [
      'https://user:token@git.example.com/octo/lib.git',
      'https://git.example.com/octo/lib',
    ],
    [
      'ssh://git@git.example.com:2222/srv/octo/lib.git',
      'https://git.example.com/srv/octo/lib',
    ],
    ['git@git.example.com:octo/lib.git', 'https://git.example.com/octo/lib'],
    ['https://github.com/octo/lib/extra', 'https://github.com/octo/lib/extra'],
  ])('links %s on any other host to the repository page', (url, expected) => {
    expect(href(url)).toBe(expected);
  });

  it.each([
    ['a path on the cloning machine', '/srv/git/lib.git'],
    ['a bare relative directory', 'lib'],
    ['a file URL', 'file:///srv/git/lib.git'],
    ['a javascript URL', 'javascript:alert(document.cookie)'],
    ['a data URL', 'data:text/html,<script>alert(1)</script>'],
    ['a URL that is not one', 'https://'],
    ['a host without a repository', 'https://git.example.com/'],
    [
      'a path that climbs out of the repository',
      'git@git.example.com:octo/../admin',
    ],
    ['a repository below the superproject', './lib'],
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
    ).toBe('https://ssh.ghost.test/ghost/lib');
  });
});
