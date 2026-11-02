import { runGit } from '../exec/run-git.js';

export interface Tag {
  name: string;
  /** The commit the tag resolves to, through any annotated tag object. */
  sha: string;
  /** The annotated tag object itself; null for a lightweight tag. */
  tagSha: string | null;
  /** Null for a lightweight tag, or a tag object written without a tagger. */
  taggerEmail: string | null;
  /** The annotation's subject; null for a lightweight tag. */
  message: string | null;
  createdAt: string;
}

const FIELDS = [
  '%(refname:strip=2)',
  '%(objecttype)',
  '%(objectname)',
  '%(*objectname)',
  '%(*objecttype)',
  '%(contents:subject)',
  '%(creatordate:iso-strict)',
  '%(taggeremail)',
];

// Stands in for a tag object written without a tagger, which leaves git no date to report.
const UNDATED = new Date(0).toISOString();

/** Every tag that resolves to a commit, newest first. An annotated tag is dated by its tagger, a lightweight one by its commit. Tags of trees or blobs are left out: nothing here can browse them. A tag of a tag counts when git peels it through to a commit. */
export async function listTags(gitDir: string): Promise<Tag[]> {
  const raw = await runGit({
    args: [
      'for-each-ref',
      '--sort=-creatordate',
      `--format=${FIELDS.join('%00')}`,
      'refs/tags/',
    ],
    gitDir,
  });

  return raw
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [name, type, oid, peeled, peeledType, subject, createdAt, email] =
        line.split('\0');
      const annotated = type === 'tag';
      if ((annotated ? peeledType : type) !== 'commit') return [];

      const date = new Date(createdAt);
      return {
        name,
        sha: annotated ? peeled : oid,
        tagSha: annotated ? oid : null,
        // git prints the address in its angle brackets.
        taggerEmail: annotated && email ? email.slice(1, -1) : null,
        message: annotated ? subject : null,
        createdAt: Number.isNaN(date.getTime()) ? UNDATED : date.toISOString(),
      };
    });
}
