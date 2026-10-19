import { describe, expect, it } from 'vitest';

import { type RefTransition, ZERO_OID } from '../git/wal/wal.types.js';
import { evaluateRulesets } from './evaluate-rulesets.js';
import type {
  RefFacts,
  Ruleset,
  RulesetActor,
  RuleType,
} from './rulesets.types.js';

const oid = (byte: number) => Buffer.alloc(20, byte);
const MAIN = 'refs/heads/main';

const create = (ref = MAIN): RefTransition => ({
  ref,
  oldOid: ZERO_OID,
  newOid: oid(1),
});
const update = (ref = MAIN): RefTransition => ({
  ref,
  oldOid: oid(1),
  newOid: oid(2),
});
const remove = (ref = MAIN): RefTransition => ({
  ref,
  oldOid: oid(1),
  newOid: ZERO_OID,
});

let nextId = 1;
const ruleset = (
  rules: RuleType[],
  overrides: Partial<Ruleset> = {},
): Ruleset => ({
  id: `ruleset_${nextId++}`,
  name: 'protect main',
  target: 'branch',
  enforcement: 'active',
  include: ['refs/heads/main'],
  exclude: [],
  bypassActors: [],
  rules: rules.map((type) => ({ type })),
  ...overrides,
});

const writer: RulesetActor = {
  role: 'write',
  teamIds: [],
  organizationAdmin: false,
};

const fastForward: RefFacts = {
  isFastForward: true,
  introducesMergeCommit: false,
};
const forced: RefFacts = { isFastForward: false, introducesMergeCommit: false };
const merged: RefFacts = { isFastForward: true, introducesMergeCommit: true };

const evaluate = ({
  rulesets,
  transitions,
  facts = {},
  actor = writer,
  write = 'push',
  defaultBranch = 'main',
}: {
  rulesets: Ruleset[];
  transitions: RefTransition[];
  facts?: Record<string, RefFacts>;
  actor?: RulesetActor;
  write?: 'push' | 'pull_request_merge';
  defaultBranch?: string;
}) =>
  evaluateRulesets({
    rulesets,
    actor,
    write,
    transitions,
    facts: new Map(Object.entries(facts)),
    defaultBranch,
  });

const rulesOf = (violations: ReturnType<typeof evaluate>) =>
  violations.map(({ ref, rule }) => [ref, rule]);

describe('evaluateRulesets', () => {
  it('allows everything when no ruleset applies', () => {
    expect(
      evaluate({
        rulesets: [],
        transitions: [create(), update(), remove('refs/heads/x')],
        facts: { [MAIN]: forced },
      }),
    ).toEqual([]);
  });

  describe('each rule', () => {
    it('creation refuses creating a targeted ref, and nothing else', () => {
      const rulesets = [ruleset(['creation'])];
      expect(rulesOf(evaluate({ rulesets, transitions: [create()] }))).toEqual([
        [MAIN, 'creation'],
      ]);
      expect(
        evaluate({
          rulesets,
          transitions: [update()],
          facts: { [MAIN]: forced },
        }),
      ).toEqual([]);
      expect(evaluate({ rulesets, transitions: [remove()] })).toEqual([]);
    });

    it('update refuses moving a targeted ref, and nothing else', () => {
      const rulesets = [ruleset(['update'])];
      expect(
        rulesOf(
          evaluate({
            rulesets,
            transitions: [update()],
            facts: { [MAIN]: fastForward },
          }),
        ),
      ).toEqual([[MAIN, 'update']]);
      expect(evaluate({ rulesets, transitions: [create()] })).toEqual([]);
      expect(evaluate({ rulesets, transitions: [remove()] })).toEqual([]);
    });

    it('deletion refuses deleting a targeted ref, and nothing else', () => {
      const rulesets = [ruleset(['deletion'])];
      expect(rulesOf(evaluate({ rulesets, transitions: [remove()] }))).toEqual([
        [MAIN, 'deletion'],
      ]);
      expect(evaluate({ rulesets, transitions: [create()] })).toEqual([]);
      expect(
        evaluate({
          rulesets,
          transitions: [update()],
          facts: { [MAIN]: forced },
        }),
      ).toEqual([]);
    });

    it('non_fast_forward refuses a move that drops commits, and allows a fast-forward', () => {
      const rulesets = [ruleset(['non_fast_forward'])];
      expect(
        rulesOf(
          evaluate({
            rulesets,
            transitions: [update()],
            facts: { [MAIN]: forced },
          }),
        ),
      ).toEqual([[MAIN, 'non_fast_forward']]);
      expect(
        evaluate({
          rulesets,
          transitions: [update()],
          facts: { [MAIN]: fastForward },
        }),
      ).toEqual([]);
    });

    it('non_fast_forward leaves creation and deletion alone', () => {
      const rulesets = [ruleset(['non_fast_forward'])];
      expect(evaluate({ rulesets, transitions: [create()] })).toEqual([]);
      expect(evaluate({ rulesets, transitions: [remove()] })).toEqual([]);
    });

    it('required_linear_history refuses a move or a creation that brings in a merge commit', () => {
      const rulesets = [ruleset(['required_linear_history'])];
      expect(
        rulesOf(
          evaluate({
            rulesets,
            transitions: [update()],
            facts: { [MAIN]: merged },
          }),
        ),
      ).toEqual([[MAIN, 'required_linear_history']]);
      expect(
        rulesOf(
          evaluate({
            rulesets,
            transitions: [create()],
            facts: { [MAIN]: merged },
          }),
        ),
      ).toEqual([[MAIN, 'required_linear_history']]);
      expect(
        evaluate({
          rulesets,
          transitions: [update()],
          facts: { [MAIN]: fastForward },
        }),
      ).toEqual([]);
      expect(evaluate({ rulesets, transitions: [remove()] })).toEqual([]);
    });

    it('fails closed when a rule needs facts nobody supplied', () => {
      expect(
        rulesOf(
          evaluate({
            rulesets: [ruleset(['non_fast_forward'])],
            transitions: [update()],
          }),
        ),
      ).toEqual([[MAIN, 'non_fast_forward']]);
      expect(
        rulesOf(
          evaluate({
            rulesets: [ruleset(['required_linear_history'])],
            transitions: [update()],
          }),
        ),
      ).toEqual([[MAIN, 'required_linear_history']]);
    });
  });

  describe('which refs', () => {
    it('ignores refs the ruleset does not target', () => {
      expect(
        evaluate({
          rulesets: [ruleset(['deletion', 'creation'])],
          transitions: [remove('refs/heads/dev'), create('refs/heads/x')],
        }),
      ).toEqual([]);
    });

    it('applies a tag ruleset to tags only', () => {
      const rulesets = [
        ruleset(['deletion'], { target: 'tag', include: ['~ALL'] }),
      ];
      expect(
        rulesOf(evaluate({ rulesets, transitions: [remove('refs/tags/v1')] })),
      ).toEqual([['refs/tags/v1', 'deletion']]);
      expect(evaluate({ rulesets, transitions: [remove(MAIN)] })).toEqual([]);
    });

    it('resolves ~DEFAULT_BRANCH against the default branch it is given', () => {
      const rulesets = [
        ruleset(['deletion'], { include: ['~DEFAULT_BRANCH'] }),
      ];
      expect(
        rulesOf(
          evaluate({
            rulesets,
            transitions: [remove('refs/heads/trunk')],
            defaultBranch: 'trunk',
          }),
        ),
      ).toEqual([['refs/heads/trunk', 'deletion']]);
      expect(
        evaluate({
          rulesets,
          transitions: [remove(MAIN)],
          defaultBranch: 'trunk',
        }),
      ).toEqual([]);
    });

    it('reports only the refused refs of a push that touches several', () => {
      expect(
        rulesOf(
          evaluate({
            rulesets: [ruleset(['deletion'])],
            transitions: [remove(MAIN), remove('refs/heads/dev')],
          }),
        ),
      ).toEqual([[MAIN, 'deletion']]);
    });
  });

  it('never evaluates a disabled ruleset', () => {
    expect(
      evaluate({
        rulesets: [ruleset(['deletion'], { enforcement: 'disabled' })],
        transitions: [remove()],
      }),
    ).toEqual([]);
  });

  it('reports every broken rule of every applicable ruleset, naming each', () => {
    const first = ruleset(['update', 'non_fast_forward'], { name: 'first' });
    const second = ruleset(['update'], {
      name: 'second',
      include: ['~ALL'],
    });
    const violations = evaluate({
      rulesets: [first, second],
      transitions: [update()],
      facts: { [MAIN]: forced },
    });

    expect(
      violations.map(({ ref, rulesetId, rulesetName, rule }) => ({
        ref,
        rulesetId,
        rulesetName,
        rule,
      })),
    ).toEqual(
      expect.arrayContaining([
        { ref: MAIN, rulesetId: first.id, rulesetName: 'first', rule: 'update' },
        {
          ref: MAIN,
          rulesetId: first.id,
          rulesetName: 'first',
          rule: 'non_fast_forward',
        },
        {
          ref: MAIN,
          rulesetId: second.id,
          rulesetName: 'second',
          rule: 'update',
        },
      ]),
    );
    expect(violations).toHaveLength(3);
    for (const violation of violations) {
      expect(violation.message).toEqual(expect.any(String));
      expect(violation.message.length).toBeGreaterThan(0);
    }
  });

  it("uses GitHub's wording for a refused force-push", () => {
    const [violation] = evaluate({
      rulesets: [ruleset(['non_fast_forward'])],
      transitions: [update()],
      facts: { [MAIN]: forced },
    });
    expect(violation.message).toBe('Cannot force-push to this branch');
  });

  describe('bypass', () => {
    const always = (actor: Ruleset['bypassActors'][number]) =>
      ruleset(['deletion'], { bypassActors: [actor] });

    it('lets a repository role at or above the listed one bypass', () => {
      const rulesets = [
        always({
          actorType: 'RepositoryRole',
          role: 'maintain',
          bypassMode: 'always',
        }),
      ];
      const as = (role: RulesetActor['role']) =>
        evaluate({
          rulesets,
          transitions: [remove()],
          actor: { ...writer, role },
        });

      expect(as('maintain')).toEqual([]);
      expect(as('admin')).toEqual([]);
      expect(rulesOf(as('write'))).toEqual([[MAIN, 'deletion']]);
      expect(rulesOf(as('read'))).toEqual([[MAIN, 'deletion']]);
      expect(rulesOf(as(null))).toEqual([[MAIN, 'deletion']]);
    });

    it('lets members of a listed team bypass', () => {
      const rulesets = [
        always({ actorType: 'Team', teamId: 'team_core', bypassMode: 'always' }),
      ];
      expect(
        evaluate({
          rulesets,
          transitions: [remove()],
          actor: { ...writer, teamIds: ['team_other', 'team_core'] },
        }),
      ).toEqual([]);
      expect(
        rulesOf(
          evaluate({
            rulesets,
            transitions: [remove()],
            actor: { ...writer, teamIds: ['team_other'] },
          }),
        ),
      ).toEqual([[MAIN, 'deletion']]);
    });

    it('lets organization administrators bypass when listed', () => {
      const rulesets = [
        always({ actorType: 'OrganizationAdmin', bypassMode: 'always' }),
      ];
      expect(
        evaluate({
          rulesets,
          transitions: [remove()],
          actor: { ...writer, organizationAdmin: true },
        }),
      ).toEqual([]);
      expect(
        rulesOf(evaluate({ rulesets, transitions: [remove()] })),
      ).toEqual([[MAIN, 'deletion']]);
    });

    it('does not let admins bypass unless they are listed', () => {
      expect(
        rulesOf(
          evaluate({
            rulesets: [ruleset(['deletion'])],
            transitions: [remove()],
            actor: { role: 'admin', teamIds: [], organizationAdmin: true },
          }),
        ),
      ).toEqual([[MAIN, 'deletion']]);
    });

    it('pull_request mode bypasses pull request merges only', () => {
      const rulesets = [
        ruleset(['update'], {
          bypassActors: [
            {
              actorType: 'RepositoryRole',
              role: 'write',
              bypassMode: 'pull_request',
            },
          ],
        }),
      ];
      expect(
        evaluate({
          rulesets,
          transitions: [update()],
          facts: { [MAIN]: fastForward },
          write: 'pull_request_merge',
        }),
      ).toEqual([]);
      expect(
        rulesOf(
          evaluate({
            rulesets,
            transitions: [update()],
            facts: { [MAIN]: fastForward },
            write: 'push',
          }),
        ),
      ).toEqual([[MAIN, 'update']]);
    });

    it('always mode bypasses pushes and merges alike', () => {
      const rulesets = [
        ruleset(['update'], {
          bypassActors: [
            { actorType: 'RepositoryRole', role: 'write', bypassMode: 'always' },
          ],
        }),
      ];
      for (const write of ['push', 'pull_request_merge'] as const) {
        expect(
          evaluate({
            rulesets,
            transitions: [update()],
            facts: { [MAIN]: fastForward },
            write,
          }),
        ).toEqual([]);
      }
    });

    it('bypassing one ruleset leaves the others in force', () => {
      const bypassed = ruleset(['deletion'], {
        name: 'bypassed',
        bypassActors: [
          { actorType: 'RepositoryRole', role: 'write', bypassMode: 'always' },
        ],
      });
      const enforced = ruleset(['deletion'], { name: 'enforced' });
      const violations = evaluate({
        rulesets: [bypassed, enforced],
        transitions: [remove()],
      });

      expect(violations.map(({ rulesetName }) => rulesetName)).toEqual([
        'enforced',
      ]);
    });
  });
});
