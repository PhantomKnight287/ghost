import type { CommitSigner } from '../commits/commit-signature.js';
import { runGit } from '../exec/run-git.js';

/** Writes an annotated tag object for `sha` into `gitDir` and returns its oid, signed as `git tag -s` signs when `signer` is given. Nothing points at it until a ref is written. */
export async function createTagObject({
  gitDir,
  sha,
  name,
  message,
  tagger,
  date = new Date(),
  signer,
}: {
  gitDir: string;
  sha: string;
  name: string;
  message: string;
  tagger: { name: string; email: string };
  date?: Date;
  signer?: CommitSigner;
}) {
  // an identity may not carry the characters that delimit it
  const clean = (value: string) => value.replace(/[<>\n]/g, '').trim();
  const seconds = Math.floor(date.getTime() / 1000);

  const payload = `object ${sha}\ntype commit\ntag ${name}\ntagger ${clean(tagger.name)} <${clean(tagger.email)}> ${seconds} +0000\n\n${message}\n`;
  const tag = signer ? `${payload}${await signer(payload)}` : payload;

  const oid = await runGit({
    args: ['mktag'],
    gitDir,
    input: Buffer.from(tag, 'utf8'),
  });
  return oid.trim();
}
