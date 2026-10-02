const PULL_REF_PREFIX = 'refs/pull/';

export function pullHeadRef(number: number) {
  return `${PULL_REF_PREFIX}${number}/head`;
}

export function pullMergeRef(number: number) {
  return `${PULL_REF_PREFIX}${number}/merge`;
}

/** Ghost writes these itself; a client push may only touch them when it is the import that carries a repository's history over from GitHub. */
export function isPullRef(ref: string) {
  return ref.startsWith(PULL_REF_PREFIX);
}
