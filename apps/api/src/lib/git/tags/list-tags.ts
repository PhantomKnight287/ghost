import { runGit } from '../exec/run-git.js';

export interface Tag {
  name: string;
  /** The commit the tag resolves to, through any annotated tag object. */
  sha: string;
  /** The annotation's subject; null for a lightweight tag. */
  message: string | null;
  createdAt: string;
}

const FIELDS = [
  '%(refname:strip=2)',
  '%(objecttype)',
  '%(objectname)',
  '%(*objectname)',
  '%(contents:subject)',
  '%(creatordate:iso-strict)',
];

/** Every tag, newest first. An annotated tag is dated by its tagger, a lightweight one by its commit. */
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
    .map((line) => {
      const [name, type, oid, peeled, subject, createdAt] = line.split('\0');
      const annotated = type === 'tag';
      return {
        name,
        sha: annotated ? peeled : oid,
        message: annotated ? subject : null,
        createdAt: new Date(createdAt).toISOString(),
      };
    });
}

/** Whether git accepts `name` as a tag. Leading dashes are refused too, so a name can never reach git as a flag. */
export async function isValidTagName(name: string) {
  if (name.startsWith('-')) return false;
  return runGit({
    args: ['check-ref-format', `refs/tags/${name}`],
    gitDir: '.',
  }).then(
    () => true,
    () => false,
  );
}
