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
        return fnmatch(full).test(ref);
      }),
  );
  return included && !excluded;
}

// GitHub's fnmatch, which is Ruby's `File.fnmatch` with `FNM_PATHNAME`: `*`, `?` and `[...]` never cross `/`, only `**/` does, a trailing `**` is a plain `*`, and braces are literal.
function fnmatch(pattern: string) {
  let source = '';
  for (let at = 0; at < pattern.length; at++) {
    const char = pattern[at];
    if (pattern.startsWith('**/', at)) {
      source += '(?:.*/)?';
      at += 2;
    } else if (char === '*') {
      source += '[^/]*';
      while (pattern[at + 1] === '*') at++;
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '\\' && at + 1 < pattern.length) {
      source += escape(pattern[++at]);
    } else if (char === '[' && pattern.indexOf(']', at + 2) > 0) {
      const end = pattern.indexOf(']', at + 2);
      const body = pattern.slice(at + 1, end);
      const negated = body[0] === '!' || body[0] === '^';
      // Within a class only `\`, `]` and `^` mean anything to a RegExp.
      const members = (negated ? body.slice(1) : body).replace(
        /[\\\]^]/g,
        (special) => `\\${special}`,
      );
      source += `(?!/)[${negated ? '^' : ''}${members}]`;
      at = end;
    } else {
      source += escape(char);
    }
  }
  return new RegExp(`^${source}$`);
}

const escape = (char: string) =>
  /[.*+?^${}()|[\]\\/-]/.test(char) ? `\\${char}` : char;
