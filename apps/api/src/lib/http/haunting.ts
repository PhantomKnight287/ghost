import type { NextFunction, Request, Response } from 'express';

/** Header values must be Latin-1, so no emoji: Node throws on anything wider. */
export const HAUNTINGS = [
  'Boo.',
  'I see dead branches.',
  'This response was ghostwritten.',
  'We are not afraid of no merge conflict.',
  'Your HEAD is detached. Spooky.',
  'Rattling chains since the initial commit.',
  'Do not look behind you. Look at the diff.',
  'git push --force is how ghosts are made.',
  'Somewhere, a rebase is still running.',
  'The call is coming from inside the monorepo.',
  'Unresolved, like most of my issues.',
  'Translucent by design.',
];

/** Easter eggs for whoever reads raw responses: `curl -i` it and see. Nothing reads these, so they are free to change. */
export function haunt(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Powered-By', 'Ectoplasm');
  res.setHeader(
    'X-Haunted-By',
    HAUNTINGS[Math.floor(Math.random() * HAUNTINGS.length)]!,
  );
  res.setHeader('X-Clacks-Overhead', 'GNU Terry Pratchett');
  res.setHeader('X-Spookiness', `${Math.floor(Math.random() * 11)}/10`);
  next();
}
