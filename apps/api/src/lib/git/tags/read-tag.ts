import {
  type SignedCommit,
  splitTagSignature,
} from '../commits/commit-signature.js';
import { runGitBuffer } from '../exec/run-git.js';

export interface TagObject {
  sha: string;
  name: string;
  /** What the tag points at, as its `object` and `type` headers name it. */
  target: { sha: string; type: string };
  /** Null for a tag object written without a tagger. */
  tagger: { name: string; email: string; date: Date } | null;
  /** The message as stored, without the signature block. */
  message: string;
  signature: SignedCommit | null;
}

const OBJECT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The annotated tag object `sha`, or null when `sha` is not a full object id, is missing, or names something other than a tag. */
export async function readTagObject({
  gitDir,
  sha,
}: {
  gitDir: string;
  sha: string;
}): Promise<TagObject | null> {
  // cat-file would resolve a tag or branch name too; only an object id is asked for here.
  if (!OBJECT_ID.test(sha)) return null;

  const raw = await runGitBuffer({
    args: ['cat-file', '--batch'],
    gitDir,
    input: Buffer.from(`${sha}\n`, 'utf8'),
  });
  const newline = raw.indexOf('\n');
  const [, type, size] = raw.subarray(0, newline).toString('utf8').split(' ');
  if (type !== 'tag') return null;

  const tag = raw
    .subarray(newline + 1, newline + 1 + Number(size))
    .toString('utf8');
  const signature = splitTagSignature(tag);
  const body = signature ? signature.payload : tag;
  const headersEnd = body.indexOf('\n\n');
  const headers = new Map(
    body
      .slice(0, headersEnd === -1 ? body.length : headersEnd)
      .split('\n')
      .map((line) => {
        const space = line.indexOf(' ');
        return [line.slice(0, space), line.slice(space + 1)] as const;
      }),
  );

  return {
    sha,
    name: headers.get('tag') ?? '',
    target: {
      sha: headers.get('object') ?? '',
      type: headers.get('type') ?? '',
    },
    tagger: parseIdentity(headers.get('tagger')),
    message: headersEnd === -1 ? '' : body.slice(headersEnd + 2),
    signature,
  };
}

/** `Name <email> <seconds> <zone>`, as git writes an identity. */
function parseIdentity(line: string | undefined) {
  const match = line?.match(/^(.*?) ?<([^>]*)> (\d+) [+-]\d{4}$/);
  if (!match) return null;
  return {
    name: match[1],
    email: match[2],
    date: new Date(Number(match[3]) * 1000),
  };
}
