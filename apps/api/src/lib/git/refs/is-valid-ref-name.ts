// Every rule `git check-ref-format` applies to a full ref name, checked in-process because a push can carry thousands of refs.
// oxlint-disable-next-line no-control-regex
const FORBIDDEN = /[\x00-\x20\x7f~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.$/;

/** Whether git accepts `ref` as a full ref name under `refs/`. A ref git would refuse must never reach the log: no node could replay it. */
export function isWellFormedRef(ref: string) {
  if (!ref.startsWith('refs/') || ref === '@' || FORBIDDEN.test(ref)) {
    return false;
  }
  return ref
    .split('/')
    .every((part) => !part.startsWith('.') && !part.endsWith('.lock'));
}

/** Whether git accepts `name` as a branch or tag. Leading dashes and `HEAD` are refused too, so a name can never reach git as a flag or shadow the symbolic ref. */
export function isValidRefName(namespace: 'heads' | 'tags', name: string) {
  if (name.startsWith('-') || name === 'HEAD') return false;
  return isWellFormedRef(`refs/${namespace}/${name}`);
}

/** A ref that cannot coexist with `ref`, since git stores `a` and `a/b` as a file and a directory of the same name; null when there is none. */
export function directoryConflict(refs: Map<string, unknown>, ref: string) {
  const parts = ref.split('/');
  for (let end = 2; end < parts.length; end++) {
    const parent = parts.slice(0, end).join('/');
    if (refs.has(parent)) return parent;
  }
  // ponytail: a scan of every ref per pushed ref. Keep the refs sorted if a repository with a very large ref count pushes many refs at once.
  const prefix = `${ref}/`;
  for (const other of refs.keys()) if (other.startsWith(prefix)) return other;
  return null;
}
