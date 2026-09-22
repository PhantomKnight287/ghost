/** Ghost answers an SSH session with text and an exit code. Nothing here reaches a shell - these are string lookups, which is the whole point. */
const GHOST = [
  '   .-""""""-.',
  "  .'        '.",
  '  |   |  |   |    ghost',
  '  |          |    git in, git out',
  '  |          |',
  '  \\_/\\_/\\_/\\_/',
].join('\n');

export function greeting(username: string) {
  return [
    GHOST,
    '',
    `Hi ${username}! You have authenticated, but Ghost does not provide shell access.`,
    'Use this connection for `git clone`, `git fetch` and `git push` instead.',
    '',
  ].join('\n');
}

/** Answers for the handful of things people type at a server that does not want them to type anything. */
const REPLIES: Record<string, (username: string) => string> = {
  whoami: (username) => username,
  ls: () => 'Your repositories are on the web. This door only opens for git.',
  'ls -la': () => 'Still nothing. Impressively thorough, though.',
  pwd: () => '/dev/null',
  uptime: () => 'Haunting continuously since the last deploy.',
  fortune: () => 'A commit you cannot reproduce is a rumour.',
  sudo: () => 'Ghost is already dead. There is nothing left to escalate to.',
  'rm -rf /': () => 'Object storage keeps the truth, and it is not here.',
  exit: () => 'You were never in.',
  help: () => 'git-upload-pack and git-receive-pack. That is the whole menu.',
  ghost: () => GHOST,
};

export function replyTo(command: string, username: string) {
  const reply = REPLIES[command.trim().replace(/\s+/g, ' ').toLowerCase()];
  if (reply) return reply(username);
  return `ghost: I only speak git, and "${command.trim()}" is not git.`;
}
