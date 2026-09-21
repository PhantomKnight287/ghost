import { runGitBuffer } from '../exec/run-git.js';

export interface SignedCommit {
  /** The commit object with its signature header removed, as git signs it. */
  payload: string;
  /** Armored signature taken from the `gpgsig` header. */
  signature: string;
}

const PGP_SIGNATURE_HEADER = '-----BEGIN PGP SIGNATURE-----';

/**
 * The signature of every named commit, keyed by sha. Commits that carry none - and signatures in a format other than OpenPGP, such as the SSH ones git can also write - are simply absent from the map.
 *
 * One `cat-file --batch` answers a whole page: `git log` cannot hand back the signature header, and a spawn per commit would be a spawn per row.
 */
export async function readSignedCommits({
  gitDir,
  env,
  shas,
}: {
  gitDir: string;
  env?: Record<string, string>;
  shas: string[];
}): Promise<Map<string, SignedCommit>> {
  const found = new Map<string, SignedCommit>();
  if (shas.length === 0) return found;

  const raw = await runGitBuffer({
    args: ['cat-file', '--batch'],
    gitDir,
    env,
    input: Buffer.from(`${shas.join('\n')}\n`, 'utf8'),
  });

  // `<sha> <type> <size>\n<size bytes>\n`, repeated. The size is the only safe boundary: a commit message can hold anything, newlines included.
  let offset = 0;
  while (offset < raw.length) {
    const newline = raw.indexOf('\n', offset);
    if (newline === -1) break;

    const [sha, type, size] = raw
      .subarray(offset, newline)
      .toString('utf8')
      .split(' ');
    // A sha git could not read is reported as `<sha> missing`, with no body.
    if (!size) {
      offset = newline + 1;
      continue;
    }

    const start = newline + 1;
    const end = start + Number(size);
    if (type === 'commit') {
      const signed = splitSignature(raw.subarray(start, end).toString('utf8'));
      if (signed) found.set(sha, signed);
    }
    offset = end + 1;
  }

  return found;
}

/**
 * Splits a raw commit into what was signed and the signature over it.
 *
 * git signs the commit object as it would read without the `gpgsig` header, so exactly that header and its continuation lines come out - every other byte is payload.
 */
export function splitSignature(commit: string): SignedCommit | null {
  const lines = commit.split('\n');
  const payload: string[] = [];
  const signature: string[] = [];
  let inSignature = false;

  for (const [index, line] of lines.entries()) {
    if (inSignature) {
      // Headers end at the blank line before the message; a continuation line of the signature is the only other line that starts with a space.
      if (line.startsWith(' ')) {
        signature.push(line.slice(1));
        continue;
      }
      inSignature = false;
    }

    // Only a header can carry the signature, and headers stop at the first blank line - a message body quoting `gpgsig ` must not be mistaken for it.
    if (
      signature.length === 0 &&
      line.startsWith('gpgsig ') &&
      lines.slice(0, index).every((header) => header !== '')
    ) {
      signature.push(line.slice('gpgsig '.length));
      inSignature = true;
      continue;
    }

    payload.push(line);
  }

  if (signature.length === 0) return null;

  const armored = signature.join('\n');
  if (!armored.startsWith(PGP_SIGNATURE_HEADER)) return null;

  return { payload: payload.join('\n'), signature: armored };
}
