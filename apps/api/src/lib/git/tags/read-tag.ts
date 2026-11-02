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

/** The annotated tag objects among `shas`, keyed by sha; anything that is not a full object id, is missing, or names something other than a tag is absent. */
export async function readTagObjects({
  gitDir,
  shas,
}: {
  gitDir: string;
  shas: string[];
}): Promise<Map<string, TagObject>> {
  const found = new Map<string, TagObject>();
  // cat-file would resolve a tag or branch name too; only object ids are asked for here.
  const wanted = shas.filter((sha) => OBJECT_ID.test(sha));
  if (wanted.length === 0) return found;

  const raw = await runGitBuffer({
    args: ['cat-file', '--batch'],
    gitDir,
    input: Buffer.from(`${wanted.join('\n')}\n`, 'utf8'),
  });

  // `<sha> <type> <size>\n<size bytes>\n`, repeated; a missing object is `<sha> missing` with no body.
  let offset = 0;
  while (offset < raw.length) {
    const newline = raw.indexOf('\n', offset);
    if (newline === -1) break;
    const [sha, type, size] = raw
      .subarray(offset, newline)
      .toString('utf8')
      .split(' ');
    if (!size) {
      offset = newline + 1;
      continue;
    }
    const end = newline + 1 + Number(size);
    if (type === 'tag')
      found.set(
        sha,
        parseTag(sha, raw.subarray(newline + 1, end).toString('utf8')),
      );
    offset = end + 1;
  }
  return found;
}

export async function readTagObject({
  gitDir,
  sha,
}: {
  gitDir: string;
  sha: string;
}): Promise<TagObject | null> {
  return (await readTagObjects({ gitDir, shas: [sha] })).get(sha) ?? null;
}

function parseTag(sha: string, tag: string): TagObject {
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
