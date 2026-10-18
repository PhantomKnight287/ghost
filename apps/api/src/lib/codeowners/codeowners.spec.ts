import { matchingRule, parseCodeowners } from './codeowners.js';

const example = [
  '# comment',
  '',
  '*       @global-owner1 @global-owner2',
  '*.js    @js-owner #This is an inline comment.',
  '*.go docs@example.com',
  '*.txt @octo-org/octocats',
  '/build/logs/ @doctocat',
  'docs/* docs@example.com',
  'apps/ @octocat',
  '/docs/',
  '**/logs @logs-owner',
].join('\n');

describe('codeowners', () => {
  const { rules, errors } = parseCodeowners(example, 'CODEOWNERS');
  const ownersOf = (path: string) => matchingRule(rules, path)?.owners;

  it('parses the documented example without errors', () => {
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(9);
    expect(rules[0]).toMatchObject({ line: 3, pattern: '*', ownerColumns: [9, 24] });
    expect(rules[1].owners).toEqual([{ kind: 'user', username: 'js-owner' }]);
    expect(rules[2].owners).toEqual([{ kind: 'email', email: 'docs@example.com' }]);
    expect(rules[3].owners).toEqual([{ kind: 'team', organization: 'octo-org', slug: 'octocats' }]);
  });

  it('lets a later rule override an earlier one', () => {
    expect(ownersOf('README')).toHaveLength(2);
    expect(ownersOf('src/a.js')).toEqual([{ kind: 'user', username: 'js-owner' }]);
  });

  it('anchors a leading slash', () => {
    const { rules: only } = parseCodeowners('/build/logs/ @doctocat', 'CODEOWNERS');
    expect(matchingRule(only, 'build/logs/x/y.txt')?.owners).toEqual([{ kind: 'user', username: 'doctocat' }]);
    expect(matchingRule(only, 'src/build/logs/a')).toBeNull();
  });

  it('matches a trailing star one level deep only', () => {
    expect(matchingRule(rules, 'docs/a.md')?.pattern).toBe('/docs/');
    expect(matchingRule(rules, 'docs/sub/b.md')?.pattern).toBe('/docs/');
    const { rules: only } = parseCodeowners('docs/* @a', 'CODEOWNERS');
    expect(matchingRule(only, 'docs/a.md')).not.toBeNull();
    expect(matchingRule(only, 'docs/sub/b.md')).toBeNull();
  });

  it('matches a directory name at any depth', () => {
    expect(ownersOf('apps/x')).toEqual([{ kind: 'user', username: 'octocat' }]);
    expect(ownersOf('src/apps/x')).toEqual([{ kind: 'user', username: 'octocat' }]);
  });

  it('keeps a rule with no owners', () => {
    expect(matchingRule(rules, 'docs/a.md')).toMatchObject({ pattern: '/docs/', owners: [] });
  });

  it('matches ** at any depth', () => {
    for (const path of ['logs', 'a/logs', 'a/b/logs/c']) expect(ownersOf(path)).toEqual([{ kind: 'user', username: 'logs-owner' }]);
  });

  it('reports invalid patterns and owners', () => {
    const { rules: none, errors: found } = parseCodeowners('!foo @a\nfoo[ab] @a\nfoo alice\n\\#file @a', 'docs/CODEOWNERS');
    expect(none).toEqual([]);
    expect(found).toEqual([
      { line: 1, column: 1, kind: 'Invalid pattern', source: '!foo @a', suggestion: null, message: 'Invalid pattern on line 1', path: 'docs/CODEOWNERS' },
      { line: 2, column: 1, kind: 'Invalid pattern', source: 'foo[ab] @a', suggestion: null, message: 'Invalid pattern on line 2', path: 'docs/CODEOWNERS' },
      { line: 3, column: 5, kind: 'Invalid owner', source: 'foo alice', suggestion: null, message: 'Invalid owner on line 3', path: 'docs/CODEOWNERS' },
      { line: 4, column: 1, kind: 'Invalid pattern', source: '\\#file @a', suggestion: null, message: 'Invalid pattern on line 4', path: 'docs/CODEOWNERS' },
    ]);
  });
});
