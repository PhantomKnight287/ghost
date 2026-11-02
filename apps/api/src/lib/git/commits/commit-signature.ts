import { SSH_SIGNATURE_HEADER } from '../../ssh/sshsig.js';
import { runGitBuffer } from '../exec/run-git.js';

export interface SignedCommit {
  /** The commit object with its signature header removed, as git signs it. */
  payload: string;
  /** Armored signature taken from the `gpgsig` header. */
  signature: string;
  format: 'openpgp' | 'ssh';
}

export interface SignedObject extends SignedCommit {
  type: 'commit' | 'tag';
}

const PGP_SIGNATURE_HEADER = '-----BEGIN PGP SIGNATURE-----';

/** Commits and tag objects without an OpenPGP or SSH signature (X.509 ones included) are absent from the map. One `cat-file --batch` answers a whole page: `git log` cannot hand back the signature header. */
export async function readSignedCommits({
  gitDir,
  env,
  shas,
}: {
  gitDir: string;
  env?: Record<string, string>;
  shas: string[];
}): Promise<Map<string, SignedObject>> {
  const found = new Map<string, SignedObject>();
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
    if (type === 'commit' || type === 'tag') {
      const body = raw.subarray(start, end).toString('utf8');
      const signed =
        type === 'commit' ? splitSignature(body) : splitTagSignature(body);
      if (signed) found.set(sha, { ...signed, type });
    }
    offset = end + 1;
  }

  return found;
}

/** git signs the commit object as it would read without the `gpgsig` header, so exactly that header and its continuation lines come out - every other byte is payload. */
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
  const format = armored.startsWith(PGP_SIGNATURE_HEADER)
    ? 'openpgp'
    : armored.startsWith(SSH_SIGNATURE_HEADER)
      ? 'ssh'
      : null;
  if (!format) return null;

  return { payload: payload.join('\n'), signature: armored, format };
}

/** A tag carries its signature as the trailing block of its message, not as a header. Like git's `parse_signature`, the last line that opens a signature starts it, so a message quoting one earlier stays payload. */
export function splitTagSignature(tag: string): SignedCommit | null {
  // A tag object opens with its `object` header, so a signature line always follows a newline.
  const newline = Math.max(
    tag.lastIndexOf(`\n${PGP_SIGNATURE_HEADER}`),
    tag.lastIndexOf(`\n${SSH_SIGNATURE_HEADER}`),
  );
  if (newline === -1) return null;
  const start = newline + 1;

  const signature = tag.slice(start);
  return {
    payload: tag.slice(0, start),
    signature,
    format: signature.startsWith(PGP_SIGNATURE_HEADER) ? 'openpgp' : 'ssh',
  };
}

export type CommitSigner = (payload: string) => Promise<string>;

/** Puts `signature` into `payload` as its `gpgsig` header, the inverse of {@link splitSignature}. */
export function insertSignature(payload: string, signature: string): string {
  const headersEnd = payload.indexOf('\n\n');
  if (headersEnd === -1) {
    throw new Error('commit object has no blank line ending its headers');
  }
  const header = signature
    .trimEnd()
    .split('\n')
    .map((line, index) => `${index === 0 ? 'gpgsig' : ''} ${line}`)
    .join('\n');
  return `${payload.slice(0, headersEnd)}\n${header}${payload.slice(headersEnd)}`;
}
