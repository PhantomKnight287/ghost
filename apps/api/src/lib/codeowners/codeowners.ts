import ignore from 'ignore';

export const CODEOWNERS_PATHS = ['.ghost/CODEOWNERS', '.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;
export const MAX_CODEOWNERS_BYTES = 3 * 1024 * 1024;

export type CodeownersOwner =
  | { kind: 'user'; username: string }
  | { kind: 'team'; organization: string; slug: string }
  | { kind: 'email'; email: string };

export type CodeownersRule = { line: number; pattern: string; owners: CodeownersOwner[]; ownerColumns: number[] };

/** GitHub's `codeowners/errors` item. */
export type CodeownersError = {
  line: number;
  column: number;
  kind: string;
  source: string;
  suggestion: string | null;
  message: string;
  path: string;
};

const compiled = new WeakMap<CodeownersRule, ReturnType<typeof ignore>>();

function parseOwner(token: string): CodeownersOwner | null {
  const team = /^@([\w.-]+)\/([\w.-]+)$/.exec(token);
  if (team) return { kind: 'team', organization: team[1], slug: team[2] };
  const user = /^@([\w.-]+)$/.exec(token);
  if (user) return { kind: 'user', username: user[1] };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token)) return { kind: 'email', email: token };
  return null;
}

export function parseCodeowners(text: string, path: string): { rules: CodeownersRule[]; errors: CodeownersError[] } {
  const rules: CodeownersRule[] = [];
  const errors: CodeownersError[] = [];

  text.split(/\r?\n/).forEach((source, index) => {
    const line = index + 1;
    const tokens = [...source.matchAll(/\S+/g)].map((match) => ({ text: match[0], column: match.index + 1 }));
    if (tokens.length === 0 || tokens[0].text.startsWith('#')) return;

    const fail = (kind: string, column: number) =>
      errors.push({ line, column, kind, source, suggestion: null, message: `${kind} on line ${line}`, path });

    const [{ text: pattern }, ...rest] = tokens;
    // GitHub supports neither negation nor character ranges, and ignore would accept both.
    if (pattern.startsWith('!') || /[[\]]/.test(pattern)) return fail('Invalid pattern', 1);

    const comment = rest.findIndex((token) => token.text.startsWith('#'));
    const ownerTokens = comment === -1 ? rest : rest.slice(0, comment);
    const owners: CodeownersOwner[] = [];
    for (const token of ownerTokens) {
      const owner = parseOwner(token.text);
      if (!owner) return fail('Invalid owner', token.column);
      owners.push(owner);
    }
    rules.push({ line, pattern, owners, ownerColumns: ownerTokens.map((token) => token.column) });
  });

  return { rules, errors };
}

function matcherOf(rule: CodeownersRule) {
  let matcher = compiled.get(rule);
  if (!matcher) {
    matcher = ignore().add(rule.pattern);
    // Gitignore's `dir/*` also owns everything below a matched subdirectory, CODEOWNERS' does not.
    if (rule.pattern.endsWith('/*')) matcher.add(`!${rule.pattern}/`);
    compiled.set(rule, matcher);
  }
  return matcher;
}

/** The last rule matching the path wins. */
export function matchingRule(rules: CodeownersRule[], filePath: string): CodeownersRule | null {
  return rules.findLast((rule) => matcherOf(rule).ignores(filePath)) ?? null;
}
