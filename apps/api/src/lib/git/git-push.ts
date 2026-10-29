import type { Request } from 'express';

/** Whether a git or LFS request writes. Git asks for the receive-pack advertisement before it pushes, so a read-only actor is turned away at `info/refs` rather than a round trip later. LFS names its operation in the batch body, which is parsed before this runs, uploads with PUT, and changes locks with POST. */
export function isGitPush(req: Request) {
  return (
    req.path.endsWith('/git-receive-pack') ||
    req.query.service === 'git-receive-pack' ||
    req.method === 'PUT' ||
    (req.method === 'POST' && req.path.includes('/info/lfs/locks')) ||
    (req.body as { operation?: unknown } | undefined)?.operation === 'upload'
  );
}

/** The `contents` level a git route needs: what `isGitPush` says, not what the HTTP method says. */
export const gitContentsLevel = (req: Request) =>
  isGitPush(req) ? 'write' : 'read';
