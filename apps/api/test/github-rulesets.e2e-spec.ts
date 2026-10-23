import type { Database } from '@ghost/db';
import { sql } from 'drizzle-orm';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>>;

/** GitHub's REST API for repository rulesets, field for field, so scripts and `gh api` calls written for GitHub work unchanged. */
describe.skipIf(!hasBackends)('GitHub repository rulesets', () => {
  let app: INestApplication;
  let owner: Account;
  let writer: Account;
  let reader: Account;
  let teamNumericId: number;
  const stamp = Date.now();
  const ownerName = `ghrsowner${stamp}`;
  const writerName = `ghrswriter${stamp}`;
  const readerName = `ghrsreader${stamp}`;
  const org = `ghrsorg${stamp}`;
  const repo = `/repos/${org}/guarded`;

  const http = () => request(app.getHttpServer());
  const db = () => app.get<Database>(DATABASE);
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const as = (account: Account) => ({
    get: (path: string) =>
      http().get(`/api/v3${path}`).set('authorization', `token ${account.key}`),
    post: (path: string, body: object) =>
      http()
        .post(`/api/v3${path}`)
        .set('authorization', `token ${account.key}`)
        .send(body),
    put: (path: string, body: object) =>
      http()
        .put(`/api/v3${path}`)
        .set('authorization', `token ${account.key}`)
        .send(body),
    delete: (path: string) =>
      http().delete(`/api/v3${path}`).set('authorization', `token ${account.key}`),
  });
  const valid = (overrides: object = {}) => ({
    name: `rules ${Math.random().toString(36).slice(2)}`,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['main'], exclude: [] } },
    rules: [{ type: 'deletion' }],
    ...overrides,
  });
  const create = async (overrides: object = {}) =>
    (await as(owner).post(`${repo}/rulesets`, valid(overrides)).expect(201)).body;
  const collaborate = async (account: Account, username: string, role: string) => {
    await http()
      .put(`/api/repositories/${org}/guarded/collaborators/${username}`)
      .set('cookie', owner.cookie)
      .send({ role })
      .expect(200);
    const invitation = (
      await http().get('/api/invitations').set('cookie', account.cookie).expect(200)
    ).body.invitations[0];
    await http()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', account.cookie)
      .expect(204);
  };

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, ownerName);
    writer = await signUp(app, writerName);
    reader = await signUp(app, readerName);
    const headers = new Headers({ cookie: owner.cookie });
    const { id: organizationId } = (await auth().createOrganization({
      body: { name: 'GitHub Rulesets', slug: org },
      headers,
    }))!;
    await http()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'guarded', organization: org, visibility: 'public' })
      .expect(201);
    await collaborate(writer, writerName, 'write');
    await collaborate(reader, readerName, 'read');
    const team = (await auth().createTeam({
      body: { name: 'Core', organizationId },
      headers,
    }))!;
    const { rows } = await db().execute<{ numeric_id: string | number }>(
      sql`select numeric_id from team where id = ${team.id}`,
    );
    teamNumericId = Number(rows[0].numeric_id);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('creates a ruleset and answers with GitHub’s shape', async () => {
    const { body } = await as(owner)
      .post(
        `${repo}/rulesets`,
        valid({
          name: 'protect main',
          conditions: {
            ref_name: { include: ['main', '~DEFAULT_BRANCH'], exclude: ['refs/heads/old'] },
          },
          bypass_actors: [
            { actor_id: 2, actor_type: 'RepositoryRole', bypass_mode: 'always' },
            { actor_id: 4, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' },
            { actor_id: teamNumericId, actor_type: 'Team', bypass_mode: 'always' },
            { actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' },
          ],
          rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
        }),
      )
      .expect(201);

    expect(body).toEqual({
      id: expect.any(Number),
      name: 'protect main',
      target: 'branch',
      source_type: 'Repository',
      source: `${org}/guarded`,
      enforcement: 'active',
      node_id: expect.any(String),
      bypass_actors: expect.arrayContaining([
        { actor_id: 2, actor_type: 'RepositoryRole', bypass_mode: 'always' },
        { actor_id: 4, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' },
        { actor_id: teamNumericId, actor_type: 'Team', bypass_mode: 'always' },
        { actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' },
      ]),
      conditions: {
        ref_name: {
          include: ['refs/heads/main', '~DEFAULT_BRANCH'],
          exclude: ['refs/heads/old'],
        },
      },
      rules: expect.arrayContaining([{ type: 'deletion' }, { type: 'non_fast_forward' }]),
      current_user_can_bypass: 'always',
      created_at: expect.any(String),
      updated_at: expect.any(String),
      _links: {
        self: { href: expect.stringMatching(new RegExp(`${repo}/rulesets/${body.id}$`)) },
        html: { href: expect.stringContaining(`/${org}/guarded/rules/${body.id}`) },
      },
    });
    expect(body.bypass_actors).toHaveLength(4);
    expect(body.rules).toHaveLength(2);

    const fetched = await as(owner).get(`${repo}/rulesets/${body.id}`).expect(200);
    expect(fetched.body).toEqual(body);
  });

  it('shows the same ruleset in Ghost’s own API with Ghost’s role names', async () => {
    const made = await create({
      name: 'mapped roles',
      bypass_actors: [
        { actor_id: 2, actor_type: 'RepositoryRole', bypass_mode: 'always' },
        { actor_id: 4, actor_type: 'RepositoryRole', bypass_mode: 'always' },
        { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
      ],
    });
    const { body } = await http()
      .get(`/api/repositories/${org}/guarded/rulesets`)
      .set('cookie', owner.cookie)
      .expect(200);
    const ghost = body.rulesets.find((ruleset: { name: string }) => ruleset.name === 'mapped roles');

    expect(ghost.bypassActors).toEqual(
      expect.arrayContaining([
        { actorType: 'RepositoryRole', role: 'maintain', bypassMode: 'always' },
        { actorType: 'RepositoryRole', role: 'write', bypassMode: 'always' },
        { actorType: 'RepositoryRole', role: 'admin', bypassMode: 'always' },
      ]),
    );
    expect(made.id).toEqual(expect.any(Number));
  });

  it('lists rulesets as summaries', async () => {
    const made = await create({ name: 'listed' });
    const { body } = await as(reader).get(`${repo}/rulesets`).expect(200);
    const listed = body.find((ruleset: { id: number }) => ruleset.id === made.id);

    expect(listed).toEqual({
      id: made.id,
      name: 'listed',
      target: 'branch',
      source_type: 'Repository',
      source: `${org}/guarded`,
      enforcement: 'active',
      node_id: made.node_id,
      created_at: made.created_at,
      updated_at: made.updated_at,
      _links: made._links,
    });
  });

  it('accepts and ignores includes_parents until organization rulesets exist', async () => {
    const made = await create({ name: 'parents' });
    const { body } = await as(reader).get(`${repo}/rulesets?includes_parents=true`).expect(200);
    expect(body.map((ruleset: { id: number }) => ruleset.id)).toContain(made.id);
  });

  it('updates only the fields given, as GitHub does', async () => {
    const made = await create({ name: 'partial', rules: [{ type: 'deletion' }, { type: 'creation' }] });
    const { body } = await as(owner)
      .put(`${repo}/rulesets/${made.id}`, { enforcement: 'disabled' })
      .expect(200);

    expect(body).toMatchObject({
      id: made.id,
      name: 'partial',
      enforcement: 'disabled',
      conditions: made.conditions,
    });
    expect(body.rules).toEqual(expect.arrayContaining(made.rules));

    const renamed = await as(owner)
      .put(`${repo}/rulesets/${made.id}`, { name: 'partial renamed', rules: [{ type: 'update' }] })
      .expect(200);
    expect(renamed.body).toMatchObject({
      name: 'partial renamed',
      enforcement: 'disabled',
      rules: [{ type: 'update' }],
    });
  });

  it('round-trips evaluate enforcement through REST and GraphQL', async () => {
    const made = await create({ name: 'evaluate trial', enforcement: 'evaluate' });
    expect(made.enforcement).toBe('evaluate');
    const { body } = await http()
      .post('/api/graphql')
      .set('authorization', `token ${owner.key}`)
      .send({
        query: `query($owner: String!) { repository(owner: $owner, name: "guarded") { rulesets(first: 100) { nodes { name enforcement } } } }`,
        variables: { owner: org },
      })
      .expect(200);
    expect(body.errors).toBeUndefined();
    expect(body.data.repository.rulesets.nodes).toContainEqual({
      name: 'evaluate trial',
      enforcement: 'EVALUATE',
    });
  });

  it('takes ref_name with include alone, and keeps exclude on an update that leaves it out', async () => {
    const made = await create({
      name: 'include only',
      conditions: { ref_name: { include: ['main'] } },
    });
    expect(made.conditions).toEqual({ ref_name: { include: ['refs/heads/main'], exclude: [] } });

    await as(owner)
      .put(`${repo}/rulesets/${made.id}`, { conditions: { ref_name: { include: ['dev'], exclude: ['old'] } } })
      .expect(200);
    const { body } = await as(owner)
      .put(`${repo}/rulesets/${made.id}`, { conditions: { ref_name: { include: ['main'] } } })
      .expect(200);
    expect(body.conditions).toEqual({
      ref_name: { include: ['refs/heads/main'], exclude: ['refs/heads/old'] },
    });
  });

  it('moves the patterns to the new target when an update changes only the target', async () => {
    const made = await create({
      name: 'retarget',
      conditions: { ref_name: { include: ['v1', '~ALL'], exclude: ['old'] } },
    });
    const { body } = await as(owner)
      .put(`${repo}/rulesets/${made.id}`, { target: 'tag' })
      .expect(200);
    expect(body).toMatchObject({
      target: 'tag',
      conditions: { ref_name: { include: ['refs/tags/v1', '~ALL'], exclude: ['refs/tags/old'] } },
    });
  });

  it('answers 404 for an id past the safe integer range', async () => {
    await as(owner).get(`${repo}/rulesets/9223372036854775807`).expect(404);
    await as(owner).get(`${repo}/rulesets/99999999999999999999`).expect(404);
  });

  it('deletes a ruleset', async () => {
    const made = await create();
    await as(owner).delete(`${repo}/rulesets/${made.id}`).expect(204);
    await as(owner).get(`${repo}/rulesets/${made.id}`).expect(404);
  });

  it('refuses invalid rulesets with 422', async () => {
    const taken = await create({ name: 'taken' });
    const invalid = [
      { rules: [{ type: 'teleport' }] },
      { rules: [{ type: 'deletion' }, { type: 'deletion' }] },
      { name: 'taken' },
      { target: 'push' },
      { enforcement: 'sometimes' },
      { bypass_actors: [{ actor_id: 3, actor_type: 'RepositoryRole', bypass_mode: 'always' }] },
      { bypass_actors: [{ actor_id: 999999999, actor_type: 'Team', bypass_mode: 'always' }] },
      { bypass_actors: [{ actor_id: 1, actor_type: 'Integration', bypass_mode: 'always' }] },
      { bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'never' }] },
      { name: '   ' },
      { name: 'x'.repeat(101) },
    ];
    for (const overrides of invalid) {
      const { status, body } = await as(owner).post(`${repo}/rulesets`, valid(overrides));
      expect({ overrides, status }).toEqual({ overrides, status: 422 });
      expect(body).toMatchObject({ message: expect.any(String) });
    }
    expect(taken.id).toEqual(expect.any(Number));
  });

  it('lets only admins change rulesets, and hides bypass actors from everyone else', async () => {
    const made = await create({
      bypass_actors: [{ actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' }],
    });
    const refused = [
      (await as(writer).post(`${repo}/rulesets`, valid())).status,
      (await as(writer).put(`${repo}/rulesets/${made.id}`, { enforcement: 'disabled' })).status,
      (await as(writer).delete(`${repo}/rulesets/${made.id}`)).status,
    ];
    for (const status of refused) expect([403, 404]).toContain(status);

    const { body } = await as(reader).get(`${repo}/rulesets/${made.id}`).expect(200);
    expect(body).not.toHaveProperty('bypass_actors');
    expect(body.rules).toEqual(made.rules);
  });

  it('tells each viewer whether they can bypass', async () => {
    const made = await create({
      bypass_actors: [
        { actor_id: 4, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' },
        { actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' },
      ],
    });
    const viewed = async (account: Account) =>
      (await as(account).get(`${repo}/rulesets/${made.id}`).expect(200)).body
        .current_user_can_bypass;

    expect(await viewed(owner)).toBe('always');
    expect(await viewed(writer)).toBe('pull_requests_only');
    expect(await viewed(reader)).toBe('never');
  });

  it('returns the active rules for a branch, slashes and all', async () => {
    const feature = await create({
      name: 'features',
      conditions: { ref_name: { include: ['feature/**/*'], exclude: [] } },
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
    });
    await create({
      name: 'features off',
      enforcement: 'disabled',
      conditions: { ref_name: { include: ['feature/**/*'], exclude: [] } },
      rules: [{ type: 'creation' }],
    });
    await create({
      name: 'feature tags',
      target: 'tag',
      conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
      rules: [{ type: 'update' }],
    });

    const { body } = await as(reader).get(`${repo}/rules/branches/feature/a/b`).expect(200);
    expect(body).toEqual(
      expect.arrayContaining([
        {
          type: 'deletion',
          ruleset_source_type: 'Repository',
          ruleset_source: `${org}/guarded`,
          ruleset_id: feature.id,
        },
        {
          type: 'non_fast_forward',
          ruleset_source_type: 'Repository',
          ruleset_source: `${org}/guarded`,
          ruleset_id: feature.id,
        },
      ]),
    );
    expect(body).toHaveLength(2);

    const none = await as(reader).get(`${repo}/rules/branches/unprotected`).expect(200);
    expect(none.body).toEqual([]);
  });

  describe('the pull_request rule', () => {
    // GitHub's documented example for a pull_request rule.
    const parameters = {
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: true,
      require_last_push_approval: true,
      required_approving_review_count: 1,
      required_review_thread_resolution: true,
      allowed_merge_methods: ['squash'],
    };

    it('creates a ruleset with it and answers the parameters field by field', async () => {
      const { body } = await as(owner)
        .post(
          `${repo}/rulesets`,
          valid({ name: 'reviews', rules: [{ type: 'pull_request', parameters }] }),
        )
        .expect(201);
      expect(body.rules).toEqual([
        { type: 'pull_request', parameters: expect.objectContaining(parameters) },
      ]);
      const fetched = await as(reader).get(`${repo}/rulesets/${body.id}`).expect(200);
      expect(fetched.body.rules).toEqual(body.rules);
    });

    it('shows it in Ghost’s own API with the same parameters', async () => {
      await create({ name: 'reviews mirrored', rules: [{ type: 'pull_request', parameters }] });
      const { body } = await http()
        .get(`/api/repositories/${org}/guarded/rulesets`)
        .set('cookie', owner.cookie)
        .expect(200);
      const ghost = body.rulesets.find(
        (ruleset: { name: string }) => ruleset.name === 'reviews mirrored',
      );
      expect(ghost.rules).toEqual([{ type: 'pull_request', parameters }]);
    });

    it('replaces the parameters when an update gives the rules', async () => {
      const made = await create({ name: 'reviews edited', rules: [{ type: 'pull_request', parameters }] });
      const changed = { ...parameters, required_approving_review_count: 3, allowed_merge_methods: ['merge', 'rebase'] };
      const { body } = await as(owner)
        .put(`${repo}/rulesets/${made.id}`, { rules: [{ type: 'pull_request', parameters: changed }] })
        .expect(200);
      expect(body.rules).toEqual([
        { type: 'pull_request', parameters: expect.objectContaining(changed) },
      ]);
    });

    it('refuses invalid parameters with 422 and a message', async () => {
      const invalid = [
        { ...parameters, required_approving_review_count: 11 },
        { ...parameters, required_approving_review_count: 'one' },
        { ...parameters, allowed_merge_methods: [] },
        { ...parameters, allowed_merge_methods: ['octopus'] },
        { ...parameters, require_code_owner_review: 'yes' },
        { ...parameters, unknown_parameter: true },
      ];
      for (const bad of invalid) {
        const { status, body } = await as(owner).post(
          `${repo}/rulesets`,
          valid({ rules: [{ type: 'pull_request', parameters: bad }] }),
        );
        expect({ bad, status }).toEqual({ bad, status: 422 });
        expect(body).toMatchObject({ message: expect.any(String) });
      }
    });

    it('returns it with its parameters among the rules for a branch', async () => {
      const made = await create({
        name: 'reviews on review-target',
        conditions: { ref_name: { include: ['review-target'], exclude: [] } },
        rules: [{ type: 'pull_request', parameters }],
      });
      const { body } = await as(reader).get(`${repo}/rules/branches/review-target`).expect(200);
      expect(body).toEqual([
        {
          type: 'pull_request',
          parameters: expect.objectContaining(parameters),
          ruleset_source_type: 'Repository',
          ruleset_source: `${org}/guarded`,
          ruleset_id: made.id,
        },
      ]);
    });
  });
});
