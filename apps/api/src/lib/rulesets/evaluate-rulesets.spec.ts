import { describe, expect, it } from 'vitest';

import { type RefTransition, ZERO_OID } from '../git/wal/wal.types.js';
import {
  allowedMergeMethods,
  evaluateRulesets,
  requiredContexts,
} from './evaluate-rulesets.js';
import type {
  PullRequestFacts,
  PullRequestRuleParameters,
  RefFacts,
  Ruleset,
  RulesetActor,
  RuleType,
  StatusCheckRuleParameters,
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

type EvaluateInput = {
  rulesets: Ruleset[];
  transitions: RefTransition[];
  facts?: Record<string, RefFacts>;
  actor?: RulesetActor;
  write?: 'push' | 'pull_request_merge';
  defaultBranch?: string;
  pullRequest?: PullRequestFacts;
};

const evaluateAll = ({
  rulesets,
  transitions,
  facts = {},
  actor = writer,
  write = 'push',
  defaultBranch = 'main',
  pullRequest,
}: EvaluateInput) =>
  evaluateRulesets({
    rulesets,
    actor,
    write,
    transitions,
    facts: new Map(Object.entries(facts)),
    defaultBranch,
    pullRequest,
  });

/** The violations that refuse the write; what the actor bypassed is checked through `evaluateAll`. */
const evaluate = (input: EvaluateInput) => evaluateAll(input).violations;

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
        {
          ref: MAIN,
          rulesetId: first.id,
          rulesetName: 'first',
          rule: 'update',
        },
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
        always({
          actorType: 'Team',
          teamId: 'team_core',
          bypassMode: 'always',
        }),
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
      expect(rulesOf(evaluate({ rulesets, transitions: [remove()] }))).toEqual([
        [MAIN, 'deletion'],
      ]);
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
            {
              actorType: 'RepositoryRole',
              role: 'write',
              bypassMode: 'always',
            },
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

    it('reports what the actor bypassed instead of dropping it', () => {
      const bypassable = ruleset(['update'], {
        name: 'bypassable',
        bypassActors: [
          { actorType: 'RepositoryRole', role: 'write', bypassMode: 'always' },
        ],
      });
      const result = evaluateAll({
        rulesets: [bypassable],
        transitions: [update()],
        facts: { [MAIN]: fastForward },
      });

      expect(result.violations).toEqual([]);
      expect(result.bypassed).toMatchObject([
        { ref: MAIN, rulesetId: bypassable.id, rule: 'update' },
      ]);
    });

    it('a bypassed ruleset lands in bypassed, not violations', () => {
      const r = evaluateAll({
        rulesets: [
          ruleset(['update'], {
            bypassActors: [
              {
                actorType: 'RepositoryRole',
                role: 'write',
                bypassMode: 'always',
              },
            ],
          }),
        ],
        transitions: [update()],
      });
      expect(r.violations).toEqual([]);
      expect(r.bypassed).toMatchObject([{ rule: 'update' }]);
    });

    it('puts a pull_request-mode bypass on a merge in bypassed, and refuses it on a push', () => {
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
      const merge = evaluateAll({
        rulesets,
        transitions: [update()],
        facts: { [MAIN]: fastForward },
        write: 'pull_request_merge',
      });
      expect(merge.violations).toEqual([]);
      expect(rulesOf(merge.bypassed)).toEqual([[MAIN, 'update']]);

      const push = evaluateAll({
        rulesets,
        transitions: [update()],
        facts: { [MAIN]: fastForward },
        write: 'push',
      });
      expect(rulesOf(push.violations)).toEqual([[MAIN, 'update']]);
      expect(push.bypassed).toEqual([]);
    });

    it('leaves bypassed empty when nothing was broken', () => {
      const result = evaluateAll({
        rulesets: [
          ruleset(['deletion'], {
            bypassActors: [
              {
                actorType: 'RepositoryRole',
                role: 'write',
                bypassMode: 'always',
              },
            ],
          }),
        ],
        transitions: [update()],
        facts: { [MAIN]: fastForward },
      });
      expect(result).toMatchObject({ violations: [], bypassed: [] });
    });
  });

  describe('pull_request', () => {
    const NO_REQUIREMENTS: PullRequestRuleParameters = {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: false,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
      allowed_merge_methods: ['merge', 'squash', 'rebase'],
    };
    const prRuleset = (
      parameters: Partial<PullRequestRuleParameters> = {},
      overrides: Partial<Ruleset> = {},
    ): Ruleset =>
      ruleset([], {
        rules: [
          {
            type: 'pull_request',
            parameters: { ...NO_REQUIREMENTS, ...parameters },
          },
        ],
        ...overrides,
      });
    const facts = (
      overrides: Partial<PullRequestFacts> = {},
    ): PullRequestFacts => ({
      authorId: 'u_author',
      method: 'squash',
      approvals: [],
      changesRequestedBy: [],
      headPushedById: 'u_author',
      codeOwners: [],
      unresolvedThreads: 0,
      ...overrides,
    });
    const approval = (
      userId: string,
      overrides: { teamIds?: string[]; stale?: boolean } = {},
    ) => ({
      userId,
      teamIds: overrides.teamIds ?? [],
      stale: overrides.stale ?? false,
    });
    const merge = (rulesets: Ruleset[], pullRequest?: PullRequestFacts) =>
      evaluate({
        rulesets,
        transitions: [update()],
        facts: { [MAIN]: fastForward },
        write: 'pull_request_merge',
        pullRequest,
      });
    const requirementsOf = (violations: ReturnType<typeof evaluate>) =>
      violations.map(({ requirement }) => requirement);

    describe('direct pushes', () => {
      it("refuses updating a targeted ref, in GitHub's words", () => {
        expect(
          evaluate({
            rulesets: [prRuleset()],
            transitions: [update()],
            facts: { [MAIN]: fastForward },
          }),
        ).toMatchObject([
          {
            ref: MAIN,
            rule: 'pull_request',
            requirement: 'pull_request',
            message: 'Changes must be made through a pull request.',
          },
        ]);
      });

      it('leaves creating and deleting the ref to their own rules', () => {
        expect(
          evaluate({ rulesets: [prRuleset()], transitions: [create()] }),
        ).toEqual([]);
        expect(
          evaluate({ rulesets: [prRuleset()], transitions: [remove()] }),
        ).toEqual([]);
      });

      it('ignores refs the ruleset does not target', () => {
        expect(
          evaluate({
            rulesets: [prRuleset()],
            transitions: [update('refs/heads/dev')],
            facts: { 'refs/heads/dev': fastForward },
          }),
        ).toEqual([]);
      });
    });

    describe('merges', () => {
      it('passes a merge with no requirements', () => {
        expect(merge([prRuleset()], facts())).toEqual([]);
      });

      it('fails closed when the pull request facts are missing', () => {
        expect(merge([prRuleset()]).map(({ rule }) => rule)).toEqual([
          'pull_request',
        ]);
      });

      it('needs the required number of approvals', () => {
        const rulesets = [prRuleset({ required_approving_review_count: 2 })];
        expect(
          requirementsOf(
            merge(rulesets, facts({ approvals: [approval('u_a')] })),
          ),
        ).toEqual(['approvals']);
        expect(
          merge(
            rulesets,
            facts({ approvals: [approval('u_a'), approval('u_b')] }),
          ),
        ).toEqual([]);
      });

      it('counts stale approvals only while stale reviews are kept', () => {
        const stale = facts({ approvals: [approval('u_a', { stale: true })] });
        expect(
          merge([prRuleset({ required_approving_review_count: 1 })], stale),
        ).toEqual([]);
        expect(
          requirementsOf(
            merge(
              [
                prRuleset({
                  required_approving_review_count: 1,
                  dismiss_stale_reviews_on_push: true,
                }),
              ],
              stale,
            ),
          ),
        ).toEqual(['approvals']);
      });

      it('blocks on a standing change request even with enough approvals', () => {
        expect(
          requirementsOf(
            merge(
              [prRuleset({ required_approving_review_count: 1 })],
              facts({
                approvals: [approval('u_a')],
                changesRequestedBy: ['u_b'],
              }),
            ),
          ),
        ).toEqual(['changes_requested']);
      });

      // GitHub: whoever requests changes must approve before the pull request can merge, whatever the approval count.
      it('blocks on a standing change request with no approvals required', () => {
        expect(
          requirementsOf(
            merge([prRuleset({})], facts({ changesRequestedBy: ['u_b'] })),
          ),
        ).toEqual(['changes_requested']);
      });

      describe('code owners', () => {
        const owned = (owners: { userIds?: string[]; teamIds?: string[] }) => ({
          pattern: '/packages/db/',
          userIds: owners.userIds ?? [],
          teamIds: owners.teamIds ?? [],
          tokens: ['@dbowner'],
        });
        const rulesets = [prRuleset({ require_code_owner_review: true })];

        it("is satisfied by an owner's approval", () => {
          expect(
            merge(
              rulesets,
              facts({
                codeOwners: [owned({ userIds: ['u_owner'] })],
                approvals: [approval('u_owner')],
              }),
            ),
          ).toEqual([]);
        });

        it("is not satisfied by someone else's approval, and names who it waits on", () => {
          const violations = merge(
            rulesets,
            facts({
              codeOwners: [owned({ userIds: ['u_owner'] })],
              approvals: [approval('u_other')],
            }),
          );
          expect(requirementsOf(violations)).toEqual(['code_owners']);
          expect(violations[0].message).toContain('@dbowner');
        });

        it('is satisfied by a member of an owning team', () => {
          expect(
            merge(
              rulesets,
              facts({
                codeOwners: [owned({ teamIds: ['team_db'] })],
                approvals: [approval('u_member', { teamIds: ['team_db'] })],
              }),
            ),
          ).toEqual([]);
        });

        it('needs every owned path satisfied', () => {
          expect(
            requirementsOf(
              merge(
                rulesets,
                facts({
                  codeOwners: [
                    owned({ userIds: ['u_owner'] }),
                    {
                      ...owned({ userIds: ['u_web'] }),
                      pattern: '/apps/web/',
                      tokens: ['@webowner'],
                    },
                  ],
                  approvals: [approval('u_owner')],
                }),
              ),
            ),
          ).toEqual(['code_owners']);
        });

        // GitHub merged a pull request whose author was the only owner of its files, with no review (checked 2026-10-22).
        it("lets an owner's own pull request through for the paths they own", () => {
          expect(
            merge(
              rulesets,
              facts({
                authorId: 'u_owner',
                codeOwners: [owned({ userIds: ['u_owner'] })],
              }),
            ),
          ).toEqual([]);
        });

        it('still waits on the paths the author does not own', () => {
          expect(
            requirementsOf(
              merge(
                rulesets,
                facts({
                  authorId: 'u_owner',
                  codeOwners: [
                    owned({ userIds: ['u_owner'] }),
                    { ...owned({ userIds: ['u_web'] }), pattern: '/apps/web/' },
                  ],
                }),
              ),
            ),
          ).toEqual(['code_owners']);
        });

        it('does not accept a stale owner approval while stale reviews are dismissed', () => {
          expect(
            requirementsOf(
              merge(
                [
                  prRuleset({
                    require_code_owner_review: true,
                    dismiss_stale_reviews_on_push: true,
                  }),
                ],
                facts({
                  codeOwners: [owned({ userIds: ['u_owner'] })],
                  approvals: [approval('u_owner', { stale: true })],
                }),
              ),
            ),
          ).toEqual(['code_owners']);
        });

        it('needs nothing when no changed path has an owner', () => {
          expect(merge(rulesets, facts())).toEqual([]);
        });
      });

      describe('last push approval', () => {
        const rulesets = [prRuleset({ require_last_push_approval: true })];

        it('is satisfied by a fresh approval from someone other than the pusher', () => {
          expect(
            merge(
              rulesets,
              facts({
                headPushedById: 'u_pusher',
                approvals: [approval('u_r')],
              }),
            ),
          ).toEqual([]);
        });

        it("is not satisfied by the pusher's own approval", () => {
          expect(
            requirementsOf(
              merge(
                rulesets,
                facts({
                  headPushedById: 'u_pusher',
                  approvals: [approval('u_pusher')],
                }),
              ),
            ),
          ).toEqual(['last_push']);
        });

        it('is not satisfied by a stale approval', () => {
          expect(
            requirementsOf(
              merge(
                rulesets,
                facts({
                  headPushedById: 'u_pusher',
                  approvals: [approval('u_r', { stale: true })],
                }),
              ),
            ),
          ).toEqual(['last_push']);
        });

        it('is not satisfied when nobody is known to have pushed', () => {
          expect(
            requirementsOf(
              merge(
                rulesets,
                facts({ headPushedById: null, approvals: [approval('u_r')] }),
              ),
            ),
          ).toEqual(['last_push']);
        });
      });

      it('needs every review thread resolved', () => {
        const rulesets = [
          prRuleset({ required_review_thread_resolution: true }),
        ];
        expect(
          requirementsOf(merge(rulesets, facts({ unresolvedThreads: 1 }))),
        ).toEqual(['threads']);
        expect(merge(rulesets, facts())).toEqual([]);
        expect(merge([prRuleset()], facts({ unresolvedThreads: 3 }))).toEqual(
          [],
        );
      });

      it('refuses a merge method the ruleset does not allow', () => {
        const rulesets = [prRuleset({ allowed_merge_methods: ['squash'] })];
        expect(
          requirementsOf(merge(rulesets, facts({ method: 'merge' }))),
        ).toEqual(['merge_method']);
        expect(merge(rulesets, facts({ method: 'squash' }))).toEqual([]);
      });

      it('reports every unmet requirement at once', () => {
        const violations = merge(
          [
            prRuleset({
              required_approving_review_count: 1,
              require_code_owner_review: true,
              required_review_thread_resolution: true,
              allowed_merge_methods: ['squash'],
            }),
          ],
          facts({
            method: 'rebase',
            unresolvedThreads: 2,
            codeOwners: [
              {
                pattern: '/packages/db/',
                userIds: ['u_owner'],
                teamIds: [],
                tokens: ['@dbowner'],
              },
            ],
          }),
        );
        expect(requirementsOf(violations).sort()).toEqual(
          ['approvals', 'code_owners', 'merge_method', 'threads'].sort(),
        );
        for (const violation of violations) {
          expect(violation.rule).toBe('pull_request');
          expect(violation.message.length).toBeGreaterThan(0);
        }
      });

      it('adds up several rulesets, naming the one that is unmet', () => {
        const one = prRuleset(
          { required_approving_review_count: 1 },
          { name: 'one' },
        );
        const two = prRuleset(
          { required_approving_review_count: 2 },
          { name: 'two', include: ['~ALL'] },
        );
        const violations = merge(
          [one, two],
          facts({ approvals: [approval('u_a')] }),
        );
        expect(
          violations.map(({ rulesetName, requirement }) => [
            rulesetName,
            requirement,
          ]),
        ).toEqual([['two', 'approvals']]);
      });

      it('lets a pull_request-mode bypasser merge over it, reporting what was bypassed', () => {
        const rulesets = [
          prRuleset(
            { required_approving_review_count: 1 },
            {
              bypassActors: [
                {
                  actorType: 'RepositoryRole',
                  role: 'admin',
                  bypassMode: 'pull_request',
                },
              ],
            },
          ),
        ];
        const result = evaluateAll({
          rulesets,
          transitions: [update()],
          facts: { [MAIN]: fastForward },
          write: 'pull_request_merge',
          pullRequest: facts(),
          actor: { ...writer, role: 'admin' },
        });
        expect(result.violations).toEqual([]);
        expect(result.bypassed.map(({ requirement }) => requirement)).toEqual([
          'approvals',
        ]);
      });
    });

    describe('allowedMergeMethods', () => {
      it('allows every method when nothing restricts them', () => {
        expect(allowedMergeMethods([], MAIN, 'main').sort()).toEqual([
          'merge',
          'rebase',
          'squash',
        ]);
      });

      it('intersects the methods of every targeting ruleset', () => {
        expect(
          allowedMergeMethods(
            [
              prRuleset({ allowed_merge_methods: ['merge', 'squash'] }),
              prRuleset({ allowed_merge_methods: ['squash', 'rebase'] }),
            ],
            MAIN,
            'main',
          ),
        ).toEqual(['squash']);
      });

      it('drops merge under required_linear_history', () => {
        expect(
          allowedMergeMethods(
            [ruleset(['required_linear_history'])],
            MAIN,
            'main',
          ).sort(),
        ).toEqual(['rebase', 'squash']);
      });

      it('ignores rulesets that do not target the ref, or are disabled', () => {
        expect(
          allowedMergeMethods(
            [
              prRuleset(
                { allowed_merge_methods: ['squash'] },
                { include: ['refs/heads/dev'] },
              ),
              prRuleset(
                { allowed_merge_methods: ['rebase'] },
                { enforcement: 'disabled' },
              ),
            ],
            MAIN,
            'main',
          ).sort(),
        ).toEqual(['merge', 'rebase', 'squash']);
      });

      it('empty method intersection blocks every method', () => {
        const rulesets = [
          prRuleset({ allowed_merge_methods: ['merge'] }),
          ruleset(['required_linear_history']),
        ];
        expect(allowedMergeMethods(rulesets, MAIN, 'main')).toEqual([]);
        for (const method of ['merge', 'squash', 'rebase'] as const) {
          expect(
            evaluate({
              rulesets,
              transitions: [update()],
              facts: {
                [MAIN]: {
                  isFastForward: true,
                  introducesMergeCommit: method === 'merge',
                },
              },
              write: 'pull_request_merge',
              pullRequest: facts({ method }),
            }).length,
          ).toBeGreaterThan(0);
        }
      });
    });
  });
});

describe('suites', () => {
  const admin: RulesetActor = { ...writer, role: 'admin' };
  const adminBypass: Ruleset['bypassActors'] = [
    { actorType: 'RepositoryRole', role: 'admin', bypassMode: 'always' },
  ];
  const resultsOf = (input: EvaluateInput) =>
    evaluateAll(input).suites.map(({ result, evaluationResult }) => [
      result,
      evaluationResult,
    ]);
  const pullRequestRuleset = (parameters: Partial<PullRequestRuleParameters>) =>
    ruleset([], {
      rules: [
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
            allowed_merge_methods: ['merge', 'squash', 'rebase'],
            ...parameters,
          },
        },
      ],
    });

  it('lists every rule of each targeting ruleset, passing ones included', () => {
    const [suite] = evaluateAll({
      rulesets: [ruleset(['creation', 'deletion', 'non_fast_forward'])],
      transitions: [update()],
      facts: { [MAIN]: fastForward },
    }).suites;
    expect(suite.transition.ref).toBe(MAIN);
    expect(suite.evaluations.map(({ rule, result }) => [rule, result])).toEqual(
      [
        ['creation', 'pass'],
        ['deletion', 'pass'],
        ['non_fast_forward', 'pass'],
      ],
    );
    expect(suite.evaluations[0]).toMatchObject({
      enforcement: 'active',
      rulesetName: 'protect main',
      requirements: [],
      details: null,
    });
    expect([suite.result, suite.evaluationResult]).toEqual(['pass', null]);
  });

  it('has no suite for a ref no ruleset targets', () => {
    const { suites } = evaluateAll({
      rulesets: [ruleset(['deletion'])],
      transitions: [update(), update('refs/heads/feature')],
      facts: { [MAIN]: fastForward },
    });
    expect(suites.map(({ transition }) => transition.ref)).toEqual([MAIN]);
  });

  it('keeps a failed pull_request rule as one evaluation holding every unmet requirement', () => {
    const [suite] = evaluateAll({
      rulesets: [
        pullRequestRuleset({
          required_approving_review_count: 1,
          required_review_thread_resolution: true,
        }),
      ],
      transitions: [update()],
      facts: { [MAIN]: fastForward },
      write: 'pull_request_merge',
      pullRequest: {
        authorId: 'u_author',
        method: 'squash',
        approvals: [],
        changesRequestedBy: [],
        headPushedById: 'u_author',
        codeOwners: [],
        unresolvedThreads: 2,
      },
    }).suites;
    expect(suite.evaluations).toEqual([
      expect.objectContaining({
        rule: 'pull_request',
        result: 'fail',
        requirements: ['approvals', 'threads'],
        details: [
          'At least 1 approving review is required by reviewers with write access.',
          'A conversation must be resolved before this pull request can be merged.',
        ].join('\n'),
      }),
    ]);
    expect(suite.result).toBe('fail');
  });

  it('passes the pull_request rule on a create or a delete', () => {
    for (const transition of [create(), remove()]) {
      const [suite] = evaluateAll({
        rulesets: [pullRequestRuleset({ required_approving_review_count: 1 })],
        transitions: [transition],
      }).suites;
      expect(suite.evaluations.map(({ result }) => result)).toEqual(['pass']);
    }
  });

  it('gives the failure message the pusher saw', () => {
    const [suite] = evaluateAll({
      rulesets: [ruleset(['update'])],
      transitions: [update()],
    }).suites;
    expect(suite.evaluations[0]).toMatchObject({
      result: 'fail',
      details: 'Cannot update this protected ref',
    });
  });

  it('makes a suite bypass when every failure was bypassed', () => {
    const evaluation = evaluateAll({
      rulesets: [ruleset(['update'], { bypassActors: adminBypass })],
      transitions: [update()],
      actor: admin,
    });
    expect(evaluation.violations).toEqual([]);
    expect(evaluation.bypassed).toHaveLength(1);
    expect(evaluation.suites.map(({ result }) => result)).toEqual(['bypass']);
  });

  it('never refuses for an evaluate ruleset', () => {
    const evaluation = evaluateAll({
      rulesets: [ruleset(['update'], { enforcement: 'evaluate' })],
      transitions: [update()],
    });
    expect(evaluation.violations).toEqual([]);
    expect(evaluation.bypassed).toEqual([]);
    expect(evaluation.suites[0].evaluations[0]).toMatchObject({
      enforcement: 'evaluate',
      result: 'fail',
    });
    expect(
      resultsOf({
        rulesets: [ruleset(['update'], { enforcement: 'evaluate' })],
        transitions: [update()],
      }),
    ).toEqual([['pass', 'fail']]);
  });

  it('does not apply bypass lists to evaluate rulesets', () => {
    expect(
      resultsOf({
        rulesets: [
          ruleset(['update'], {
            enforcement: 'evaluate',
            bypassActors: adminBypass,
          }),
        ],
        transitions: [update()],
        actor: admin,
      }),
    ).toEqual([['pass', 'fail']]);
  });

  it('counts active failures in the evaluation result too', () => {
    const passingEvaluate = ruleset(['deletion'], { enforcement: 'evaluate' });
    expect(
      resultsOf({
        rulesets: [ruleset(['update']), passingEvaluate],
        transitions: [update()],
      }),
    ).toEqual([['fail', 'fail']]);
    expect(
      resultsOf({
        rulesets: [
          ruleset(['update'], { bypassActors: adminBypass }),
          passingEvaluate,
        ],
        transitions: [update()],
        actor: admin,
      }),
    ).toEqual([['bypass', 'bypass']]);
  });

  it('does not evaluate disabled rulesets', () => {
    expect(
      evaluateAll({
        rulesets: [ruleset(['update'], { enforcement: 'disabled' })],
        transitions: [update()],
      }).suites,
    ).toEqual([]);
  });

  it('judges an evaluate non_fast_forward rule by the facts it is given', () => {
    const rulesets = [
      ruleset(['non_fast_forward'], { enforcement: 'evaluate' }),
    ];
    expect(
      resultsOf({
        rulesets,
        transitions: [update()],
        facts: { [MAIN]: fastForward },
      }),
    ).toEqual([['pass', 'pass']]);
    expect(
      resultsOf({
        rulesets,
        transitions: [update()],
        facts: { [MAIN]: forced },
      }),
    ).toEqual([['pass', 'fail']]);
  });
});

const checks = (
  contexts: string[],
  parameters: Partial<StatusCheckRuleParameters> = {},
  overrides: Partial<Ruleset> = {},
) =>
  ruleset([], {
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: contexts.map((context) => ({ context })),
          strict_required_status_checks_policy: false,
          do_not_enforce_on_create: false,
          ...parameters,
        },
      },
    ],
    ...overrides,
  });

const withStatuses = (
  statuses: RefFacts['statuses'],
  extra: Partial<RefFacts> = {},
): Record<string, RefFacts> => ({
  [MAIN]: { ...fastForward, statuses, ...extra },
});

describe('required_status_checks', () => {
  it('passes a tip with success on every required context', () => {
    const evaluation = evaluateAll({
      rulesets: [checks(['build', 'test'])],
      transitions: [update()],
      facts: withStatuses([
        { context: 'build', state: 'success' },
        { context: 'test', state: 'success' },
        { context: 'lint', state: 'failure' },
      ]),
    });
    expect(evaluation.violations).toEqual([]);
  });

  it('fails a missing context as expected', () => {
    const { violations } = evaluateAll({
      rulesets: [checks(['build'])],
      transitions: [update()],
      facts: withStatuses([]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: 'required_status_checks',
      requirement: 'status_checks',
    });
    expect(violations[0].message).toContain('build');
    expect(violations[0].message).toContain('expected');
  });

  it.each(['pending', 'failure', 'error'] as const)(
    'fails a context whose latest state is %s',
    (state) => {
      const { violations } = evaluateAll({
        rulesets: [checks(['build'])],
        transitions: [update()],
        facts: withStatuses([{ context: 'build', state }]),
      });
      expect(violations.map(({ requirement }) => requirement)).toEqual([
        'status_checks',
      ]);
      expect(violations[0].message).toContain(state);
    },
  );

  it('requires the union of every applicable ruleset’s contexts', () => {
    const { violations } = evaluateAll({
      rulesets: [checks(['build']), checks(['test'])],
      transitions: [update()],
      facts: withStatuses([{ context: 'build', state: 'success' }]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('test');
  });

  it('skips a create only for the rule that opts out of creations', () => {
    const skipping = checks(['build'], { do_not_enforce_on_create: true });
    const enforcing = checks(['test']);
    const { violations } = evaluateAll({
      rulesets: [skipping, enforcing],
      transitions: [create()],
      facts: withStatuses([]),
    });
    expect(violations.map(({ rulesetId }) => rulesetId)).toEqual([
      enforcing.id,
    ]);
  });

  it('does not judge a deletion', () => {
    expect(
      evaluateAll({
        rulesets: [checks(['build'])],
        transitions: [remove()],
      }).violations,
    ).toEqual([]);
  });

  it('fails a merge whose head is behind the base under strict', () => {
    const { violations } = evaluateAll({
      rulesets: [
        checks(['build'], { strict_required_status_checks_policy: true }),
      ],
      transitions: [update()],
      write: 'pull_request_merge',
      facts: withStatuses([{ context: 'build', state: 'success' }], {
        upToDate: false,
      }),
    });
    expect(violations.map(({ requirement }) => requirement)).toEqual([
      'up_to_date',
    ]);
  });

  it('passes a merge that is up to date under strict', () => {
    expect(
      evaluateAll({
        rulesets: [
          checks(['build'], { strict_required_status_checks_policy: true }),
        ],
        transitions: [update()],
        write: 'pull_request_merge',
        facts: withStatuses([{ context: 'build', state: 'success' }], {
          upToDate: true,
        }),
      }).violations,
    ).toEqual([]);
  });

  it('adds nothing for strict on a push', () => {
    expect(
      evaluateAll({
        rulesets: [
          checks(['build'], { strict_required_status_checks_policy: true }),
        ],
        transitions: [update()],
        facts: withStatuses([{ context: 'build', state: 'success' }]),
      }).violations,
    ).toEqual([]);
  });

  it('fails closed without statuses facts', () => {
    expect(
      evaluateAll({
        rulesets: [checks(['build'])],
        transitions: [update()],
        facts: { [MAIN]: fastForward },
      }).violations.map(({ requirement }) => requirement),
    ).toEqual(['status_checks']);
  });

  it('moves an unmet check to bypassed for an always bypass actor', () => {
    const evaluation = evaluateAll({
      rulesets: [
        checks(
          ['build'],
          {},
          {
            bypassActors: [
              {
                actorType: 'RepositoryRole',
                role: 'admin',
                bypassMode: 'always',
              },
            ],
          },
        ),
      ],
      transitions: [update()],
      actor: { ...writer, role: 'admin' },
      facts: withStatuses([]),
    });
    expect(evaluation.violations).toEqual([]);
    expect(evaluation.bypassed.map(({ rule }) => rule)).toEqual([
      'required_status_checks',
    ]);
  });

  it('never refuses for an evaluate ruleset', () => {
    const evaluation = evaluateAll({
      rulesets: [checks(['build'], {}, { enforcement: 'evaluate' })],
      transitions: [update()],
      facts: withStatuses([]),
    });
    expect(evaluation.violations).toEqual([]);
    expect(evaluation.suites[0].evaluationResult).toBe('fail');
  });
});

describe('required_signatures', () => {
  const signatures = (overrides: Partial<Ruleset> = {}) =>
    ruleset(['required_signatures'], overrides);

  it('passes when every added commit verifies', () => {
    expect(
      evaluateAll({
        rulesets: [signatures()],
        transitions: [update()],
        facts: { [MAIN]: { ...fastForward, unverifiedCommits: [] } },
      }).violations,
    ).toEqual([]);
  });

  it('lists every unverified commit', () => {
    const { violations } = evaluateAll({
      rulesets: [signatures()],
      transitions: [update()],
      facts: {
        [MAIN]: {
          ...fastForward,
          unverifiedCommits: [
            { sha: 'a'.repeat(40), reason: 'Unsigned' },
            {
              sha: 'b'.repeat(40),
              reason: 'Signature does not match the commit',
            },
          ],
        },
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: 'required_signatures',
      requirement: 'signatures',
    });
    expect(violations[0].message).toContain('aaaaaaa');
    expect(violations[0].message).toContain('bbbbbbb');
  });

  it('summarises past ten unverified commits', () => {
    const { violations } = evaluateAll({
      rulesets: [signatures()],
      transitions: [update()],
      facts: {
        [MAIN]: {
          ...fastForward,
          unverifiedCommits: Array.from({ length: 12 }, (_, index) => ({
            sha: index.toString(16).repeat(40),
            reason: 'Unsigned',
          })),
        },
      },
    });
    expect(violations[0].message).toContain('and 2 more');
  });

  it('fails closed without unverifiedCommits facts', () => {
    expect(
      evaluateAll({
        rulesets: [signatures()],
        transitions: [update()],
        facts: { [MAIN]: fastForward },
      }).violations.map(({ requirement }) => requirement),
    ).toEqual(['signatures']);
  });

  it('does not judge a deletion', () => {
    expect(
      evaluateAll({
        rulesets: [signatures()],
        transitions: [remove()],
      }).violations,
    ).toEqual([]);
  });
});

describe('requiredContexts', () => {
  it('unions active rulesets targeting the ref, sorted', () => {
    expect(
      requiredContexts(
        [checks(['test', 'build']), checks(['build', 'lint'])],
        MAIN,
        'main',
      ),
    ).toEqual(['build', 'lint', 'test']);
  });

  it('leaves out evaluate and disabled rulesets and other refs', () => {
    expect(
      requiredContexts(
        [
          checks(['build'], {}, { enforcement: 'evaluate' }),
          checks(['test'], {}, { enforcement: 'disabled' }),
          checks(['lint'], {}, { include: ['refs/heads/release'] }),
        ],
        MAIN,
        'main',
      ),
    ).toEqual([]);
  });
});
