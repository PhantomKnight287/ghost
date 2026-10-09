import { describe, expect, it } from 'vitest';
import { decodeNodeId, decodeNodeIdAs, encodeNodeId } from './node-id.js';
import { CouldNotResolveError } from './github.errors.js';

describe('node ids', () => {
  it('round-trips every type with GitHub prefixes', () => {
    expect(encodeNodeId('Issue', 'issue_abc')).toMatch(/^I_/);
    expect(encodeNodeId('IssueComment', 'ic_abc')).toMatch(/^IC_/);
    expect(encodeNodeId('Label', 'label_x')).toMatch(/^LA_/);
    expect(encodeNodeId('PullRequest', 'issue_y')).toMatch(/^PR_/);
    for (const type of ['User', 'Organization', 'Repository', 'Issue', 'PullRequest', 'IssueComment', 'Label'] as const) {
      expect(decodeNodeId(encodeNodeId(type, 'some_id-1'))).toEqual({ type, id: 'some_id-1' });
    }
  });

  it('rejects unknown prefixes, missing separators and empty ids', () => {
    expect(decodeNodeId('ZZ_abc')).toBeNull();
    expect(decodeNodeId('nounderscore')).toBeNull();
    expect(decodeNodeId('I_')).toBeNull();
  });

  it('refuses an id of another type with GitHub wording', () => {
    const label = encodeNodeId('Label', 'label_x');
    expect(() => decodeNodeIdAs(label, 'Issue')).toThrow(CouldNotResolveError);
    expect(() => decodeNodeIdAs(label, 'Issue')).toThrow(`Could not resolve to a node with the global id of '${label}'`);
    expect(decodeNodeIdAs(label, 'Label')).toBe('label_x');
  });
});
