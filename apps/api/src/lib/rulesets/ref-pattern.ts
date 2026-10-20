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
        return fnmatch(full, ref);
      }),
  );
  return included && !excluded;
}

type Token = '**/' | '*' | ((char: string) => boolean);

// GitHub's fnmatch, which is Ruby's `File.fnmatch` with `FNM_PATHNAME`: `*`, `?` and `[...]` never cross `/`, only `**/` does, a trailing `**` is a plain `*`, and braces are literal.
// Walks the set of ref positions each token can reach rather than backtracking, so any pattern costs at most tokens × ref length.
function fnmatch(pattern: string, ref: string) {
  let reached = Array.from({ length: ref.length + 1 }, (_, at) => at === 0);
  for (const token of tokensOf(pattern)) {
    const next = reached.map(() => false);
    let open = false;
    for (let at = 0; at <= ref.length; at++) {
      if (token === '**/') {
        // Nothing, or anything up to and including a `/`.
        next[at] = reached[at] || (open && ref[at - 1] === '/');
        open ||= reached[at];
      } else if (token === '*') {
        open = reached[at] || (open && ref[at - 1] !== '/');
        next[at] = open;
      } else if (reached[at] && at < ref.length && token(ref[at])) {
        next[at + 1] = true;
      }
    }
    reached = next;
  }
  return reached[ref.length];
}

function tokensOf(pattern: string) {
  const tokens: Token[] = [];
  for (let at = 0; at < pattern.length; at++) {
    const char = pattern[at];
    if (pattern.startsWith('**/', at)) {
      tokens.push('**/');
      at += 2;
    } else if (char === '*') {
      tokens.push('*');
      while (pattern[at + 1] === '*') at++;
    } else if (char === '?') {
      tokens.push((c) => c !== '/');
    } else if (char === '\\' && at + 1 < pattern.length) {
      const escaped = pattern[++at];
      tokens.push((c) => c === escaped);
    } else if (char === '[' && pattern.indexOf(']', at + 2) > 0) {
      const end = pattern.indexOf(']', at + 2);
      const body = pattern.slice(at + 1, end);
      const negated = body[0] === '!' || body[0] === '^';
      // Within a class only `\`, `]` and `^` mean anything to a RegExp; it tests one character, so it cannot backtrack.
      const members = (negated ? body.slice(1) : body).replace(
        /[\\\]^]/g,
        (special) => `\\${special}`,
      );
      const member = new RegExp(`^[${negated ? '^' : ''}${members}]$`);
      tokens.push((c) => c !== '/' && member.test(c));
      at = end;
    } else {
      tokens.push((c) => c === char);
    }
  }
  return tokens;
}
