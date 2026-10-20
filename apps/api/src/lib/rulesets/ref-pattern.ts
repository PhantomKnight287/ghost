import path from 'node:path';

const SPECIAL_TARGETS = ['~DEFAULT_BRANCH', '~ALL'] as const;

export function normalizeRefPattern(target: 'branch' | 'tag', pattern: string) {
  if (SPECIAL_TARGETS.includes(pattern as (typeof SPECIAL_TARGETS)[number]))
    return pattern;
  if (!pattern.startsWith('refs/'))
    return `refs/${target === 'branch' ? 'heads' : 'tags'}/${pattern}`;
  return pattern;
}

export function refTargeted(
  payload: {
    target: 'branch' | 'tag';
    include: string[];
    exclude: string[];
  },
  ref: string,
  defaultBranch: string,
) {
  const prefix = payload.target === 'branch' ? 'refs/heads/' : 'refs/tags/';
  // anything outside the target's namespace (refs/pull/*, the other type) is never targeted
  if (!ref.startsWith(prefix)) return false;

  const [included, excluded] = [payload.include, payload.exclude].map(
    (patterns) =>
      patterns.some((pattern) => {
        const full = normalizeRefPattern(payload.target, pattern);
        if (full === '~ALL') return true;
        if (full === '~DEFAULT_BRANCH')
          return ref === `refs/heads/${defaultBranch}`;
        return path.matchesGlob(ref, full);
      }),
  );
  return included && !excluded;
}
